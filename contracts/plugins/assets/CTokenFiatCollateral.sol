// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

// ==== External Interfaces ====
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

// ==== End External Interfaces ====

contract CTokenFiatCollateral is CompoundOracleMixin, Collateral {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    // cToken initial exchange rate is 0.02
    uint192 public constant COMPOUND_BASE = uint192(FIX_SCALE / 50);

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public override rewardERC20;

    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
        IERC20 rewardERC20_
    ) {
        init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            comptroller_,
            rewardERC20_
        );
    }

    function init(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
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
        __CompoundOracleMixin_init(comptroller_);
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok(); // {collateral/reference}
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return consultOracle(referenceERC20).mul(refPerTok());
    }

    /// Default checks
    function forceUpdates() external virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }
        uint256 cached = whenDefault;

        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        if (referencePrice.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            // Check for soft default of underlying reference token
            try this.consultOracle(referenceERC20) returns (uint192 p) {
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                if (p < peg - delta || p > peg + delta) {
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
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20.decimals()) - 18;
        uint192 rateNow = shiftl_toFix(rate, shiftLeft);
        return rateNow.div(COMPOUND_BASE);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = address(comptroller);
        _cd = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
