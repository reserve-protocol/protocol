// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./ICusdcV3Wrapper.sol";
import "./vendor/IComet.sol";

/**
 * @title CTokenV3Collateral
 * @notice Collateral plugin for Compound V3,
 * tok = wcUSDC
 * ref = USDC
 * tar = USD
 * UoA = USD
 */
contract CTokenV3Collateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IComet public immutable comet;
    uint8 public immutable cometDecimals;
    IERC20 private immutable comp;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        comp = ICusdcV3Wrapper(address(config.erc20)).rewardERC20();
        comet = IComet(address(ICusdcV3Wrapper(address(erc20)).underlyingComet()));
        cometDecimals = comet.decimals();
    }

    /// @custom:delegate-call
    function claimRewards() external override(Asset, IRewardable) {
        uint256 _bal = comp.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - _bal);
    }

    function underlyingRefPerTok() public view virtual override returns (uint192) {
        return
            shiftl_toFix(
                ICusdcV3Wrapper(address(erc20)).exchangeRate(),
                -int8(cometDecimals),
                FLOOR
            );
    }

    /// Refresh exchange rates and update default status.
    /// @dev Should not need to override: can handle collateral with variable refPerTok()
    function refresh() public virtual override {
        ICusdcV3Wrapper(address(erc20)).accrue();

        CollateralStatus oldStatus = status();

        // Check for hard default
        // must happen before tryPrice() call since `refPerTok()` returns a stored value

        // revenue hiding: do not DISABLE if drawdown is small
        try this.underlyingRefPerTok() returns (uint192 underlyingRefPerTok_) {
            // {ref/tok} = {ref/tok} * {1}
            uint192 hiddenReferencePrice = underlyingRefPerTok_.mul(revenueShowing);

            // uint192(<) is equivalent to Fix.lt
            if (underlyingRefPerTok_ < exposedReferencePrice) {
                exposedReferencePrice = underlyingRefPerTok_;
                markStatus(CollateralStatus.DISABLED);
            } else if (hiddenReferencePrice > exposedReferencePrice) {
                exposedReferencePrice = hiddenReferencePrice;
            }

            // Check for soft default + save prices
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {target/ref}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high != FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
                    savedPegPrice = pegPrice;
                    lastSave = uint48(block.timestamp);
                } else {
                    // must be unpriced
                    // untested:
                    //      validated in other plugins, cost to test here is high
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
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.DISABLED);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }
}
