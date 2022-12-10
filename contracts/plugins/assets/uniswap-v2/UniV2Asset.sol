// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../../../interfaces/IAsset.sol";
import "../OracleLib.sol";
import "../../../libraries/Fixed.sol";
import "./libraries/UniV2Math.sol";

import "../../../interfaces/IAsset.sol";

contract UniV2Asset is IAsset {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IUniswapV2Pair public immutable pairV2;
    IERC20Metadata public immutable erc20;
    uint8 public immutable erc20Decimals;

    AggregatorV3Interface public immutable chainlinkFeedA;
    AggregatorV3Interface public immutable chainlinkFeedB;

    uint8 public immutable decA;
    uint8 public immutable decB;

    uint192 public immutable override maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA/Tok}
    uint256 public immutable delayUntilDefault; // {s} e.g 86400
    uint48 public immutable oracleTimeout;

    /// constructor
    /// @param pairV2_ UniswapV2 pair address
    /// @param fallbackPrice_ fallback price for LP tokens
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA = USD
    /// @param delayUntilDefault_ delay until default from IFFY status
    /// @param chainlinkFeedA_ Feed units: {UoA/tokA}
    /// @param chainlinkFeedB_ Feed units: {UoA/tokB}
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        address pairV2_,
        uint192 fallbackPrice_,
        uint192 maxTradeVolume_,
        uint256 delayUntilDefault_,
        AggregatorV3Interface chainlinkFeedA_,
        AggregatorV3Interface chainlinkFeedB_,
        uint48 oracleTimeout_
    ) {
        require(fallbackPrice_ > 0, "[UNIV2A DEPLOY ERROR]: fallback price zero");
        require(address(pairV2_) != address(0), "[UNIV2A DEPLOY ERROR]: missing PairV2");
        require(
            address(chainlinkFeedA_) != address(0),
            "[UNIV2A DEPLOY ERROR]: missing chainlink feed for token A"
        );
        require(
            address(chainlinkFeedB_) != address(0),
            "[UNIV2A DEPLOY ERROR]: missing chainlink feed for token B"
        );
        require(maxTradeVolume_ > 0, "[UNIV2A DEPLOY ERROR]: invalid max trade volume");
        require(delayUntilDefault_ > 0, "[UNIV2A DEPLOY ERROR]: delayUntilDefault zero");
        require(oracleTimeout_ > 0, "[UNIV2A DEPLOY ERROR]: oracleTimeout zero");
        fallbackPrice = fallbackPrice_;
        maxTradeVolume = maxTradeVolume_;
        delayUntilDefault = delayUntilDefault_;
        chainlinkFeedA = chainlinkFeedA_;
        chainlinkFeedB = chainlinkFeedB_;
        pairV2 = IUniswapV2Pair(pairV2_);
        decA = IUniswapV2ERC20(pairV2.token0()).decimals();
        decB = IUniswapV2ERC20(pairV2.token1()).decimals();
        erc20 = IERC20Metadata(pairV2_);
        erc20Decimals = pairV2.decimals();
        oracleTimeout = oracleTimeout_;
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price() as (pA* rA + pB*rB) / L
    function strictPrice() external view override returns (uint192) {
        uint192 pA = 0;
        uint192 pB = 0;
        pA = chainlinkFeedA.price(oracleTimeout);
        pB = chainlinkFeedB.price(oracleTimeout);
        (uint112 x, uint112 y, ) = pairV2.getReserves();
        // reserves to 18 decimals
        uint192 reserveA = uint192(x * 10**(18 - decA));
        uint192 reserveB = uint192(y * 10**(18 - decB));
        uint256 totalSupply = pairV2.totalSupply();
        return (reserveA.mulu(pA) + reserveB.mulu(pB)).divu(totalSupply, ROUND);
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return {tok} The balance of the ERC20 in whole tokens.
    /// @dev remember UNIV2 is also a ERC20 token ...
    function bal(address account) external view override returns (uint192) {
        return shiftl_toFix(pairV2.balanceOf(account), -int8(erc20Decimals));
    }

    // solhint-disable no-empty-blocks

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev Use delegatecall
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks

    function isCollateral() external view virtual override returns (bool) {
        return false;
    }
}
