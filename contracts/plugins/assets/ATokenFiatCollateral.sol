// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

// ==== External ====

// External interfaces from: https://git.io/JX7iJ
interface IStaticAToken is IERC20Metadata {
    function claimRewardsToSelf(bool forceUpdate) external;

    // @return RAY{fiatTok/tok}
    function rate() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (AToken);

    function getClaimableRewards(address user) external view returns (uint256);
}

interface AToken {
    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

// ==== End External ====

contract ATokenFiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    uint192 public defaultThreshold; // {%} e.g. 0.05

    uint256 public delayUntilDefault; // {s} e.g 86400

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public override rewardERC20;

    // solhint-disable-next-line func-name-mixedcase
    function ATokenFiatCollateral_init(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20 rewardERC20_
    ) external initializer {
        __Asset_init(chainlinkFeed_, erc20_, maxTradeVolume_);
        __Collateral_init(targetName_);
        __ATokenFiatCollateral_init(defaultThreshold_, delayUntilDefault_, rewardERC20_);
    }

    // solhint-disable-next-line func-name-mixedcase
    function __ATokenFiatCollateral_init(
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20 rewardERC20_
    ) internal onlyInitializing {
        defaultThreshold = defaultThreshold_;
        delayUntilDefault = delayUntilDefault_;

        prevReferencePrice = refPerTok(); // {collateral/reference}
        rewardERC20 = rewardERC20_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price().mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        if (referencePrice.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            try chainlinkFeed.price_() returns (uint192 p) {
                priceable = true;

                // Check for soft default of underlying reference token
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                if (p < peg - delta || p > peg + delta) {
                    whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
                } else whenDefault = NEVER;
            } catch {
                priceable = false;
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return priceable ? CollateralStatus.SOUND : CollateralStatus.UNPRICED;
        } else if (whenDefault > block.timestamp) {
            return priceable ? CollateralStatus.IFFY : CollateralStatus.UNPRICED;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray ref/tok}
        return shiftl_toFix(rateInRAYs, -27);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = address(erc20); // this should be a StaticAToken
        _cd = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}
