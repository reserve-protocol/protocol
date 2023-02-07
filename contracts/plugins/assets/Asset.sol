// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/IAsset.sol";
import "./OracleLib.sol";

contract Asset is IAsset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable chainlinkFeed; // {UoA/tok}

    IERC20Metadata public immutable erc20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable override maxTradeVolume; // {UoA}

    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    uint192 public immutable oracleError; // {1} The max % deviation allowed by the oracle

    // === Lot price ===

    uint48 public immutable priceTimeout; // {s} The period over which `savedHighPrice` decays to 0

    uint192 public savedLowPrice; // {UoA/tok} The low price of the token during the last update

    uint192 public savedHighPrice; // {UoA/tok} The high price of the token during the last update

    uint48 public lastSave; // {s} The timestamp when prices were last saved

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param chainlinkFeed_ Feed units: {UoA/tok}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint48 priceTimeout_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    ) {
        require(priceTimeout_ > 0, "price timeout zero");
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(oracleError_ > 0 && oracleError_ < FIX_ONE, "oracle error out of range");
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        priceTimeout = priceTimeout_;
        chainlinkFeed = chainlinkFeed_;
        oracleError = oracleError_;
        erc20 = erc20_;
        erc20Decimals = erc20.decimals();
        maxTradeVolume = maxTradeVolume_;
        oracleTimeout = oracleTimeout_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev The third (unused) variable is only here for compatibility with Collateral
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    function tryPrice()
        external
        view
        virtual
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        uint192 p = chainlinkFeed.price(oracleTimeout); // {UoA/tok}
        uint192 delta = p.mul(oracleError);
        return (p - delta, p + delta, 0);
    }

    /// Should not revert
    /// Refresh saved prices
    function refresh() public virtual override {
        try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
            // {UoA/tok}, {UoA/tok}
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
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
        }
    }

    /// Should not revert
    /// @dev Should be general enough to not need to be overridden
    /// @return {UoA/tok} The lower end of the price estimate
    /// @return {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192, uint192) {
        try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
            assert(low <= high);
            return (low, high);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return (0, FIX_MAX);
        }
    }

    /// Should not revert
    /// lotLow should be nonzero when the asset might be worth selling
    /// @dev Should be general enough to not need to be overridden
    /// @return lotLow {UoA/tok} The lower end of the lot price estimate
    /// @return lotHigh {UoA/tok} The upper end of the lot price estimate
    function lotPrice() external view virtual returns (uint192 lotLow, uint192 lotHigh) {
        try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
            // if the price feed is still functioning, use that
            lotLow = low;
            lotHigh = high;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string

            // if the price feed is broken, use a decayed historical value

            uint48 delta = uint48(block.timestamp) - lastSave; // {s}
            if (delta >= priceTimeout) return (0, 0); // no price after timeout elapses

            // {1} = {s} / {s}
            uint192 lotMultiplier = divuu(priceTimeout - delta, priceTimeout);

            // {UoA/tok} = {UoA/tok} * {1}
            lotLow = savedLowPrice.mul(lotMultiplier);
            lotHigh = savedHighPrice.mul(lotMultiplier);
        }
        assert(lotLow <= lotHigh);
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    // solhint-disable no-empty-blocks

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev Use delegatecall
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks
}
