// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "./IUniswapV3Wrapper.sol";
import "hardhat/console.sol";

contract UniswapV3Collateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    AggregatorV3Interface public immutable chainlinkFeedSecondAsset;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV3Wrapper erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            IERC20Metadata(erc20_),
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
        uint256 price0adj = (price0 * amount0) / liquidity;
        uint256 price1adj = (price1 * amount1) / liquidity;
        int8 shift0 = -int8(IERC20Metadata(token0).decimals()) - 18;
        int8 shift1 = -int8(IERC20Metadata(token1).decimals()) - 18;
        return uint192((shiftl_toFix(price0adj, shift0) + shiftl_toFix(price1adj, shift1)));
    }

    function strictPrice() external view override returns (uint192) {
        (address token0, address token1, uint256 amount0, uint256 amount1) = IUniswapV3Wrapper(address(erc20))
            .principal();
        return _calculatePrice(token0, token1, amount0, amount1, IERC20(erc20).totalSupply());
    }

    function _fallbackPrice() public view returns (uint192) {
        (address token0, address token1, uint256 amount0, uint256 amount1, uint128 liquidity) = IUniswapV3Wrapper(
            address(erc20)
        ).priceSimilarPosition();
        console.log("amount0", "amount1", amount0, amount1);
        return _calculatePrice(token0, token1, amount0, amount1, liquidity);
    }

    function price(bool allowFallback) public view override returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, _fallbackPrice());
        }
    }

    //TODO RefPerTok() always equals 1 but we need to implement check
    function claimRewards() external {
        (address token0, address token1, uint256 amount0, uint256 amount1) = IUniswapV3Wrapper(address(erc20))
            .claimRewards(msg.sender);
        emit RewardsClaimed(IERC20(token0), amount0);
        emit RewardsClaimed(IERC20(token1), amount1);
    }
}
