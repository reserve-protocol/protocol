// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/Iwsteth.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title WSTETHCollateral
 * @notice Collateral plugin for wstETH,
 * tok = wstETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract WSTETHCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable USD_ETHChainlinkFeed; // {UoA/ref}
    AggregatorV3Interface public immutable ETH_STETHChainlinkFeed; // {ref/tok}
    uint192 public immutable defaultRelativeThreshold; // e.g. 85% would be 0.85 * 10**18

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param USD_ETHChainlinkFeed_ Feed units: {UoA/ref}
    /// @param ETH_STETHChainlinkFeed_ Feed units: {ref/unwrapped(tok)}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultRelativeThreshold_ {%} A value like 0.85 that represents a relative deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    /// @notice ETH_STETHChainlinkFeed_ returns the value for unwrapped steth, not the wrapped version used as token
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface USD_ETHChainlinkFeed_,
        AggregatorV3Interface ETH_STETHChainlinkFeed_,
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
            address(ETH_STETHChainlinkFeed_) != address(0),
            "missing collateral token unit chainlink feed"
        );
        USD_ETHChainlinkFeed = USD_ETHChainlinkFeed_;
        ETH_STETHChainlinkFeed = ETH_STETHChainlinkFeed_;
        defaultRelativeThreshold = defaultRelativeThreshold_;
        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} The market price of 1 whole wstETH in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/rebase} * {rebase/tok}
        return
            USD_ETHChainlinkFeed
                .price(oracleTimeout)
                .mul(ETH_STETHChainlinkFeed.price(oracleTimeout))
                .mul(refPerTok());
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
                try ETH_STETHChainlinkFeed.price_(oracleTimeout) returns (uint192 eth_wsteth) {
                    // Because the oracle is steth/eth and steth rebases 1:1 with ref the depeg test is simply
                    // a direct comparison
                    if (eth_wsteth < defaultRelativeThreshold) {
                        markStatus(CollateralStatus.IFFY);
                    } else {
                        // Common path is status is already sound. Avoid the 100 gas new_val == current_val SSTORE
                        if (oldStatus != CollateralStatus.SOUND) markStatus(CollateralStatus.SOUND);
                    }
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert();
                    // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert();
                // solhint-disable-line reason-string
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
        uint256 rate = Iwsteth(address(erc20)).stEthPerToken();
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
