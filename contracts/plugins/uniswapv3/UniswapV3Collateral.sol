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

    /// Can return 0, can revert
    /// Shortcut for price(false)
    /// @return {UoA/tok} The current price(), without considering fallback prices
    function strictPrice() external view override returns (uint192) {
        (address token0, address token1, uint256 amount0, uint256 amount1) = IUniswapV3Wrapper(address(erc20))
            .principal();
        uint192 price0 = chainlinkFeed.price(oracleTimeout);
        uint192 price1 = chainlinkFeedSecondAsset.price(oracleTimeout);
        uint256 price0adj = price0 * amount0;
        uint256 price1adj = price1 * amount1;
        int8 shift0 = -int8(IERC20Metadata(token0).decimals()) - 18;
        int8 shift1 = -int8(IERC20Metadata(token1).decimals()) - 18;
        return uint192(shiftl_toFix(price0adj, shift0) + shiftl_toFix(price1adj, shift1));
    }

    //TODO RefPerTok() always equals 1 but we need to implement check
    function claimRewards() external {
        (address token0, address token1, uint256 amount0, uint256 amount1) = IUniswapV3Wrapper(address(erc20))
            .claimRewards(msg.sender);
        emit RewardsClaimed(IERC20(token0), amount0);
        emit RewardsClaimed(IERC20(token1), amount1);
    }
}
