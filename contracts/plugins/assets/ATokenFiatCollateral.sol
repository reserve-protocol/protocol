// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

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

contract ATokenFiatCollateral is AaveOracleMixin, Collateral {
    using FixLib for int192;
    using SafeERC20 for IERC20Metadata;

    int192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public override rewardERC20;

    constructor(
        IERC20Metadata erc20_,
        int192 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_,
        IERC20 rewardERC20_
    ) {
        init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            comptroller_,
            aaveLendingPool_,
            rewardERC20_
        );
    }

    function init(
        IERC20Metadata erc20_,
        int192 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_,
        IERC20 rewardERC20_
    ) public initializer {
        __Collateral_init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            bytes32(bytes("USD"))
        );
        __AaveOracleMixin_init(comptroller_, aaveLendingPool_);
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok(); // {collateral/reference}
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (int192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return consultOracle(referenceERC20).mul(refPerTok());
    }

    /// Default checks
    function forceUpdates() external virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }
        uint256 cached = whenDefault;

        // TODO gas optimization
        // 1. remove fixlib

        // Check for hard default
        int192 referencePrice = refPerTok();
        if (referencePrice.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            // Check for soft default of underlying reference token
            try this.consultOracle(referenceERC20) returns (int192 p) {
                // TODO remove fixlib usage?

                // {UoA/ref} = {UoA/target} * {target/ref}
                int192 peg = pricePerTarget().mul(targetPerRef());
                int192 delta = peg.mul(defaultThreshold);

                // If the price is below the default-threshold price, default eventually
                if (p.lt(peg.minus(delta)) || p.gt(peg.plus(delta))) {
                    whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
                } else whenDefault = NEVER;
            } catch Panic(uint256) {
                // This indicates a problem in the price function!
                assert(false); // To confirm: there is no way to maintain the error code here
            } catch (bytes memory lowLevelData) {
                if (bytes4(lowLevelData) == bytes4(keccak256("PriceIsZero()"))) {
                    // This means the oracle has broken on us and we should default immediately
                    whenDefault = block.timestamp;
                } else revert UnknownError(lowLevelData);
            }
        }
        prevReferencePrice = referencePrice;

        if (whenDefault != cached) {
            emit DefaultStatusChanged(cached, whenDefault, status());
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (int192) {
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
