// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { CEIL, FixLib, _safeWrap } from "../../../libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "../OracleLib.sol";
import { CollateralConfig, AppreciatingFiatCollateral } from "../AppreciatingFiatCollateral.sol";

interface CBEth is IERC20Metadata {
    function mint(address account, uint256 amount) external returns (bool);

    function updateExchangeRate(uint256 exchangeRate) external;

    function configureMinter(address minter, uint256 minterAllowedAmount) external returns (bool);

    function exchangeRate() external view returns (uint256 _exchangeRate);
}

/**
 * @title CBEthCollateral
 * @notice Collateral plugin for Coinbase's staked ETH
 * tok = cbETH
 * ref = ETH2
 * tar = ETH
 * UoA = USD
 */
contract CBEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    CBEth public immutable token;
    AggregatorV3Interface public immutable targetPerTokChainlinkFeed; // {target/tok}
    uint48 public immutable targetPerTokChainlinkTimeout;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param _targetPerTokChainlinkFeed {target/tok} price of cbETH in ETH terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _targetPerTokChainlinkFeed,
        uint48 _targetPerTokChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(_targetPerTokChainlinkFeed) != address(0), "missing targetPerTok feed");
        require(_targetPerTokChainlinkTimeout != 0, "targetPerTokChainlinkTimeout zero");

        token = CBEth(address(config.erc20));
        targetPerTokChainlinkFeed = _targetPerTokChainlinkFeed;
        targetPerTokChainlinkTimeout = _targetPerTokChainlinkTimeout;
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
        uint192 targetPerTok = targetPerTokChainlinkFeed.price(targetPerTokChainlinkTimeout);

        // {UoA/tok} = {UoA/target} * {target/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(targetPerTok);
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {target/ref} = {ref/tok} / {target/tok}
        pegPrice = _underlyingRefPerTok().div(targetPerTok);
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(token.exchangeRate());
    }
}
