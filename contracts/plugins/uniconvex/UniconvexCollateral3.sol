// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "hardhat/console.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurvePool_3.sol";


contract UniconvexCollateral3 is Collateral {
    using OracleLib for AggregatorV3Interface;
    AggregatorV3Interface[N_COINS] public chainlinkFeeds;
    ICurvePool public immutable curvePool;

    constructor(
        ICurvePool _curvePool,
        uint192 fallbackPrice_,
        AggregatorV3Interface[N_COINS] memory chainlinkFeeds_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeeds_[0],
            IERC20Metadata(address(erc20_)),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(address(_curvePool) != address(0), "missing curvePool");
        curvePool = _curvePool;
        for (uint i = 1; i < N_COINS; i++) {
            require(address(chainlinkFeeds[i]) != address(0), "missing chainlink feed for second asset in pair");    
        }
        chainlinkFeeds = chainlinkFeeds_;
    }

    // function refPerTok() public view override returns (uint192) {
    //     IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
    //     // Seems like can be safety replaced with sellPrice(feeOn)
    //     (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
    //     uint256 rootK = Math.sqrt(reserve0 * reserve1);
    //     return uint192((rootK * 10**18) / pair.totalSupply());
    // }

    // function _calculatePrice(
    //     address token0,
    //     address token1,
    //     uint256 amount0,
    //     uint256 amount1,
    //     uint256 liquidity
    // ) internal view returns (uint192) {
    //     uint192 price0 = chainlinkFeed.price(oracleTimeout);
    //     uint192 price1 = chainlinkFeedSecondAsset.price(oracleTimeout);
    //     //TODO liquidity can be 10 ** 18 for some assets.
    //     //Resulting price per one liquidity would have too bad precision. Need to check
    //     uint256 priceScaled0 = (price0 * amount0) / liquidity / 10**IERC20Metadata(token0).decimals();
    //     uint256 priceScaled1 = (price1 * amount1) / liquidity / 10**IERC20Metadata(token1).decimals();
    //     return uint192(priceScaled0 + priceScaled1);
    // }

    // // supply never zero on uniswap v2, so can revert only if feeds revert
    // function strictPrice() external view override returns (uint192) {
    //     IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
    //     (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
    //     return _calculatePrice(pair.token0(), pair.token1(), reserve0, reserve1, IERC20(erc20).totalSupply());
    // }

    
}
