// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

interface BalancerPoolOracle {
    function getLatest(uint8 variable) external view returns (uint256);
}

contract NoteAsset is IAsset {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable chainlinkFeed;
    BalancerPoolOracle public immutable balancerFeed;

    IERC20Metadata public immutable erc20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable override maxTradeVolume; // {UoA}

    uint192 public immutable fallbackPrice; // {UoA}

    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    /// @param chainlinkFeed_ Feed units: {aux/tok}
    /// @param balancerFeed_ Feed units: {UoA/aux}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        BalancerPoolOracle balancerFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    )
    {
        require(fallbackPrice_ > 0, "fallback price zero");
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(address(balancerFeed_) != address(0), "missing balancer feed");
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        fallbackPrice = fallbackPrice_;
        chainlinkFeed = chainlinkFeed_;
        balancerFeed = balancerFeed_;
        erc20 = erc20_;
        erc20Decimals = erc20.decimals();
        maxTradeVolume = maxTradeVolume_;
        oracleTimeout = oracleTimeout_;
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    function strictPrice() public view override returns (uint192) {
        // get price of NOTE in WETH
        try balancerFeed.getLatest(0) returns (uint256 notePriceInWeth_) {
            // get price of WETH is USD
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 wethPriceInUsd) {
                uint192 notePriceInWeth = _safeWrap(notePriceInWeth_);
                // return price
                return notePriceInWeth / FIX_ONE * wethPriceInUsd;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert();
                // solhint-disable-line reason-string
                return fallbackPrice;
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert();
            // solhint-disable-line reason-string
            return fallbackPrice;
        }
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view virtual returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), - int8(erc20Decimals));
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
