// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/Icbeth.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CBETHCollateral
 * @notice Collateral plugin for cbETH,
 * tok = cbETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract CBETHCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable USD_ETHChainlinkFeed; // {UoA/ref}
    AggregatorV3Interface public immutable ETH_CBETHChainlinkFeed; // {ref/tok}
    uint192 public immutable defaultRelativeThreshold; // e.g. 85% would be 0.85 * 10**18

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param USD_ETHChainlinkFeed_ Feed units: {UoA/ref}
    /// @param ETH_CBETHChainlinkFeed_ Feed units: {ref/tok}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultRelativeThreshold_ {%} A value like 0.85 that represents a relative deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface USD_ETHChainlinkFeed_,
        AggregatorV3Interface ETH_CBETHChainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultRelativeThreshold_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            USD_ETHChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultRelativeThreshold_ > 0, "defaultThreshold zero");
        require(
            address(ETH_CBETHChainlinkFeed_) != address(0),
            "missing collateral token unit chainlink feed"
        );
        USD_ETHChainlinkFeed = USD_ETHChainlinkFeed_;
        ETH_CBETHChainlinkFeed = ETH_CBETHChainlinkFeed_;
        defaultRelativeThreshold = defaultRelativeThreshold_;
        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} The market price of 1 whole cbETH in UoA
    /// @notice this is found by combining usd/eth and eth/cbeth oracles, not a function of refPerTok()
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return
            USD_ETHChainlinkFeed.price(oracleTimeout).mul(
                ETH_CBETHChainlinkFeed.price(oracleTimeout)
            );
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try USD_ETHChainlinkFeed.price_(oracleTimeout) returns (uint192) {
                try ETH_CBETHChainlinkFeed.price_(oracleTimeout) returns (uint192 eth_cbeth) {
                    // Check if market price of cbETH has depegged from expected value of ethusd * exchangeRate
                    // full test would be:    ethusd * cbeth_eth < eth_usd * exchangeRate * defaultRelativeThreshold
                    // simplified equivalent:          cbeth_eth <           exchangeRate * defaultRelativeThreshold
                    // we only care in the case it is under the expected value, over is fine
                    if (eth_cbeth < refPerTok().mul(defaultRelativeThreshold)) {
                        markStatus(CollateralStatus.IFFY);
                    } else {
                        // Common path is status is already sound. Avoid the 100 gas new_val == current_val SSTORE
                        if (oldStatus != CollateralStatus.SOUND) markStatus(CollateralStatus.SOUND);
                    }
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = Icbeth(address(erc20)).exchangeRate();
        return _safeWrap(rate);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return USD_ETHChainlinkFeed.price(oracleTimeout);
    }

    function claimRewards() external virtual override {
        // There are no rewards to claim
        emit RewardsClaimed(IERC20(address(0)), 0);
    }
}
