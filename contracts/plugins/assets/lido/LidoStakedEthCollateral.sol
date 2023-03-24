// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./IWSTETH.sol";

/**
 * @title Lido Staked Eth Collateral
 * @notice Collateral plugin for Lido stETH,
 * tok = wstETH  (wrapped stETH)
 * ref = stETH (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract LidoStakedEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // In order to provide tighter price estimates this contract uses {UoA/tok} and {ref/target}
    // price feeds. Here we include them directly and ignore the parent class' chainlinkFeed.

    /// @param config.chainlinkFeed {UoA/ref} Override parent class type
    /// @param config.oracleError {1} Should be the oracle error _only_ for the {UoA/ref} feed
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(config.chainlinkFeedAlt1) != address(0), "missing targetPerRef feed");
        require(config.chainlinkFeedAlt1Timeout > 0, "chainlinkFeedAlt1Timeout zero");
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // for the purposes of pricing the peg, we use market price
        // {target/ref} Get current market peg ({eth/steth})
        pegPrice = chainlinkFeedAlt1.price(chainlinkFeedAlt1Timeout);

        // for the purpose of calculating {UoA/tok}, we consider {target} == {ref}
        // {UoA/target} == {UoA/ref}
        uint192 pricePerRef = chainlinkFeed.price(oracleTimeout);

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pLow = pricePerRef.mul(refPerTok());
        uint192 pHigh = pricePerRef.mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IWSTETH(address(erc20)).stEthPerToken();
        return _safeWrap(rate);
    }
}
