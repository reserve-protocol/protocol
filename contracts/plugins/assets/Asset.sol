// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "./OracleLib.sol";

contract Asset is IAsset {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable chainlinkFeed;

    IERC20Metadata public immutable erc20;

    IERC20 public immutable override rewardERC20;

    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    TradingRange public tradingRange;

    /// @param chainlinkFeed_ Feed units: {UoA/tok}
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        TradingRange memory tradingRange_,
        uint48 oracleTimeout_
    ) {
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(address(erc20_) != address(0), "missing erc20");
        require(
            tradingRange_.minAmt > 0 &&
                tradingRange_.maxAmt > 0 &&
                tradingRange_.maxAmt >= tradingRange_.minAmt,
            "invalid trading range amts"
        );
        require(tradingRange_.maxVal >= tradingRange_.minVal, "invalid trading range vals");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        chainlinkFeed = chainlinkFeed_;
        erc20 = erc20_;
        rewardERC20 = rewardERC20_;
        tradingRange = tradingRange_;
        oracleTimeout = oracleTimeout_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20.decimals()));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    // solhint-disable no-empty-blocks

    /// @return min {tok} The minimium trade size
    function minTradeSize() external view virtual returns (uint192 min) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // {tok} = {UoA} / {UoA/tok}
            // return tradingRange.minVal.div(p, CEIL);
            uint256 min256 = (FIX_ONE_256 * tradingRange.minVal + p - 1) / p;
            if (type(uint192).max < min256) revert UIntOutOfBounds();
            min = uint192(min256);
        } catch {}
        if (min < tradingRange.minAmt) min = tradingRange.minAmt;
        if (min > tradingRange.maxAmt) min = tradingRange.maxAmt;
    }

    /// @return max {tok} The maximum trade size
    function maxTradeSize() external view virtual returns (uint192 max) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // {tok} = {UoA} / {UoA/tok}
            // return tradingRange.maxVal.div(p);
            uint256 max256 = (FIX_ONE_256 * tradingRange.maxVal) / p;
            if (type(uint192).max < max256) revert UIntOutOfBounds();
            max = uint192(max256);
        } catch {}
        if (max == 0 || max > tradingRange.maxAmt) max = tradingRange.maxAmt;
        if (max < tradingRange.minAmt) max = tradingRange.minAmt;
    }

    /// (address, calldata) to call in order to claim rewards for holding this asset
    /// @dev The default impl returns zero values, implying that no reward function exists.
    function getClaimCalldata() external view virtual returns (address _to, bytes memory _cd) {}

    // solhint-enable no-empty-blocks
}
