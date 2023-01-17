// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "contracts/plugins/assets/FiatCollateral.sol";
import "./ICusdcV3Wrapper.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

contract CTokenV3Collateral is FiatCollateral {
    struct CometCollateralConfig {
        IERC20 rewardERC20;
        uint256 reservesThresholdIffy;
        uint256 reservesThresholdDisabled;
    }

    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IERC20 public immutable rewardERC20;
    IComet public immutable comet;
    uint256 public immutable reservesThresholdIffy;
    uint256 public immutable reservesThresholdDisabled;

    constructor(CollateralConfig memory config, CometCollateralConfig memory cometConfig) FiatCollateral(config) {
        require(address(cometConfig.rewardERC20) != address(0), "rewardERC20 missing");
        require(cometConfig.reservesThresholdIffy > 0, "reservesThresholdIffy zero");
        require(cometConfig.reservesThresholdDisabled > 0, "reservesThresholdDisabled zero");

        rewardERC20 = cometConfig.rewardERC20;
        reservesThresholdIffy = cometConfig.reservesThresholdIffy;
        reservesThresholdDisabled = cometConfig.reservesThresholdDisabled;
        prevReferencePrice = refPerTok();
        comet = IComet(ICusdcV3Wrapper(address(erc20)).underlyingComet());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override(FiatCollateral) {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        int256 cometReserves = comet.getReserves();

        if (
            referencePrice < prevReferencePrice ||
            cometReserves < 0 ||
            uint256(cometReserves) < reservesThresholdDisabled
        ) {
            markStatus(CollateralStatus.DISABLED);
        } else if (uint256(cometReserves) < reservesThresholdIffy) {
            markStatus(CollateralStatus.IFFY);
        } else {
            // Check for soft default + save lotPrice
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {target/ref}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high < FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
                    lastSave = uint48(block.timestamp);
                } else {
                    // must be unpriced
                    assert(low == 0);
                }

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (pegPrice < pegBottom || pegPrice > pegTop || low == 0) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// @dev Returns the exchange rate between the underlying balance of CUSDC and the balance
    ///   of the wCUSDC.
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 exchangeRate = ICusdcV3Wrapper(address(erc20)).exchangeRate();
        return _safeWrap(exchangeRate);
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    function claimRewards() external {
        IERC20 comp = rewardERC20;
        uint256 oldBal = comp.balanceOf(address(this));
        ICusdcV3Wrapper(address(erc20)).claimTo(address(this), address(this));
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - oldBal);
    }
}
