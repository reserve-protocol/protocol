// SPDX-License-Identifier: agpl-3.0

// done as part of a reserver-protocol hackathon
pragma solidity ^0.8.9;

import "./UniswapV2AbstractCollateral.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "hardhat/console.sol";


contract UniswapV2FiatCollateral is UniswapV2AbstractCollateral {
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV2Pair erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        UniswapV2AbstractCollateral(
            fallbackPrice_,
            chainlinkFeed_,
            chainlinkFeedSecondAsset_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;
    }

    function priceNotInBounds(uint192 p, uint192 peg, uint192 delta) internal pure returns (bool) {
        return p < peg - delta || p > peg + delta;
    }

    function poolIsAwayFromOptimalPoint(uint192 peg, uint192 delta) internal view returns (bool) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        uint256 p = FIX_ONE * 10 ** IERC20Metadata(pair.token1()).decimals() * reserve0 / reserve1/
            10 ** IERC20Metadata(pair.token0()).decimals();
        console.log("pool price", p);
        console.log("peg", peg);
        console.log("delta", delta);
        return priceNotInBounds(uint192(p), peg, delta);
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;

        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        pair.sync();

        CollateralStatus oldStatus = status();

        try chainlinkFeed.price_(oracleTimeout) returns (uint192 price0) {
            try chainlinkFeedSecondAsset.price_(oracleTimeout) returns (uint192 price1) {
                console.log("price0", price0);
                console.log("price1", price1);
                uint192 peg = pricePerTarget();
                uint192 delta = (peg * defaultThreshold) / FIX_ONE;
                if (
                    priceNotInBounds(price0, peg, delta) ||
                    priceNotInBounds(price1, peg, delta) ||
                    poolIsAwayFromOptimalPoint(peg, delta)
                ) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert();
                markStatus(CollateralStatus.IFFY);
            }
        } catch (bytes memory errData) {
            if (errData.length == 0) revert();
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    /// {target} = {UoA} and {ref} = {tok}
    /// The same as strictPrice when price of assets equal to pricePerTarget()
    function targetPerRef() public view override returns (uint192) {
        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        return
            uint192(
                (FIX_ONE * 10 ** 18 * 2) /
                    Math.sqrt(10 ** (IERC20Metadata(pair.token0()).decimals() + IERC20Metadata(pair.token1()).decimals()))
            );
    }
    
}
