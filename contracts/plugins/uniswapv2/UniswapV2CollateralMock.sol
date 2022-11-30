// SPDX-License-Identifier: agpl-3.0

// done as part of a reserver-protocol hackathon
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";
import "./UniswapV2Collateral.sol";

//TODO Unsiwap uses 112 bits floating points math for price accumulators
contract UniswapV2CollateralMock is UniswapV2Collateral {
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
        UniswapV2Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            chainlinkFeedSecondAsset_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {}

    function _feeOn() internal view returns (bool) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        address feeTo = IUniswapV2Factory(pair.factory()).feeTo();
        return feeTo != address(0);
    }

    // function to investigate ability of using balances in price calculation
    // returns amounts can be obtained on burn liquidity
    function sellPrice(bool feeOn)
        internal
        view
        returns (
            uint256 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        uint256 _totalSupply = pair.totalSupply();
        if (feeOn) {
            uint256 _kLast = pair.kLast();
            //is this check enough to depends on feeOn in refPerTok
            if (_kLast != 0) {
                (uint112 _reserve0, uint112 _reserve1, ) = pair.getReserves();
                uint256 rootK = Math.sqrt(_reserve0 * _reserve1);
                uint256 rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint256 numerator = _totalSupply * (rootK - rootKLast);
                    uint256 denominator = (rootK * 5) + rootKLast;
                    _totalSupply += numerator / denominator;
                }
            }
        }
        address _token0 = pair.token0();
        address _token1 = pair.token1();
        amount0 = IERC20(_token0).balanceOf(address(pair));
        amount1 = IERC20(_token1).balanceOf(address(pair));
        liquidity = _totalSupply;
    }
}
