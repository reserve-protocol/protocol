// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

//TODO Uniswap2 doesnt update some values until block changed
//so we need some checks for blocks
//ALSO Unsiwap uses 112 bits floating points math for price accumulators
contract UniswapV2Collateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    AggregatorV3Interface public immutable chainlinkFeedSecondAsset;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV2Pair erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            IERC20Metadata(address(erc20_)),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(address(chainlinkFeedSecondAsset_) != address(0), "missing chainlink feed for second asset in pair");
        chainlinkFeedSecondAsset = chainlinkFeedSecondAsset_;
    }

    function _calculatePrice(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    ) internal view returns (uint192) {
        uint192 price0 = chainlinkFeed.price(oracleTimeout);
        uint192 price1 = chainlinkFeedSecondAsset.price(oracleTimeout);
        //TODO liquidity can be 10 ** 18 for some assets.
        //Resulting price per one liquidity would have too bad precision. Need to check
        uint256 priceScaled0 = (price0 * amount0) / liquidity / 10**IERC20Metadata(token0).decimals();
        uint256 priceScaled1 = (price1 * amount1) / liquidity / 10**IERC20Metadata(token1).decimals();
        return uint192(priceScaled0 + priceScaled1);
    }

    function strictPrice() external view override returns (uint192) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) = pair.getReserves();
        return _calculatePrice(pair.token0(), pair.token0(), reserve0, reserve1, IERC20(erc20).totalSupply());
    }

    function refPerTok() public view override returns (uint192) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) = pair.getReserves();
        uint256 rootK = Math.sqrt(reserve0 * reserve1);
        return uint192(rootK / pair.totalSupply());
    } 

    function _fallbackPrice() public view returns (uint192) {
        //TODO calculate expected price for one liquidity
        return strictPrice();
    }

    function price(bool allowFallback) public view override returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, _fallbackPrice());
        }
    }

    
    function claimRewards() external override {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        emit RewardsClaimed(IERC20(pair.token0()), 0);
        emit RewardsClaimed(IERC20(pair.token1()), 0);
    }
}
