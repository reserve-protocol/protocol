// SPDX-License-Identifier: agpl-3.0

// done as part of a reserver-protocol hackathon
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

//TODO Unsiwap uses 112 bits floating points math for price accumulators
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

    function refPerTok() public view override returns (uint192) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        // Seems like can be safety replaced with sellPrice(feeOn)
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        uint256 rootK = Math.sqrt(reserve0 * reserve1);
        return uint192((rootK * 10**18) / pair.totalSupply());
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

    // supply never zero on uniswap v2, so can revert only if feeds revert
    function strictPrice() external view override returns (uint192) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        return _calculatePrice(pair.token0(), pair.token1(), reserve0, reserve1, IERC20(erc20).totalSupply());
    }

    function _feeOn() internal view returns (bool) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        address feeTo = IUniswapV2Factory(pair.factory()).feeTo();
        return feeTo != address(0);
    }

    // returns amounts can be obtained on burn liquidity
    function sellPrice(bool feeOn) internal view returns (uint256 liquidity, uint256 amount0, uint256 amount1) {
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

    // TODO ask emtpy implementation without events is enough
    // function claimRewards() external override {
    //     IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
    //     emit RewardsClaimed(IERC20(pair.token0()), 0);
    //     emit RewardsClaimed(IERC20(pair.token1()), 0);
    // }
}
