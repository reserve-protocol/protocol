// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "./IUniswapV3Wrapper.sol";
import "./UniswapV3Collateral.sol";

/**
    @title Uniswap V3 Same Target Fiat Collateral
    @notice Collateral plugin for non-fiat Uniswap V3 positions
    @notice Requires Uniswap V3 Wrapper to be deployed first to wrap the position used
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */

/*
This would be sensible for many UNI v2 pools, but someone holding value in a two-sided USD-fiatcoin pool probably intends to represent a USD position with those holdings, and so it'd be better for the Collateral plugin to have a target of USD. This is coherent so long as the Collateral plugin is setup to default under any of the following conditions:

- According to a trusted oracle, USDC is far from \$1 for some time
- According a trusted oracle, USDT is far from \$1 for some time
- The UNI v2 pool is far from the 1:1 point for some time

And even then, it would be somewhat dangerous for an RToken designer to use this LP token as a _backup_ Collateral position -- because whenever the pool's proportion is away from 1:1 at all, it'll take more than \$1 of collateral to buy an LP position that can reliably convert to \$1 later.
*/
contract UniswapV3UsdCollateral is UniswapV3Collateral {
    using OracleLib for AggregatorV3Interface;
    uint24 public immutable tickThreshold;

    uint192 public immutable defaultThreshold;

    constructor(
        uint192 fallbackPrice_,
        uint192 fallbackPriceSecondAsset_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV3Wrapper uniswapV3Wrapper_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint24 tickThreshold_,
        uint256 delayUntilDefault_
    )
        UniswapV3Collateral(
            fallbackPrice_,
            fallbackPriceSecondAsset_,
            chainlinkFeed_,
            chainlinkFeedSecondAsset_,
            uniswapV3Wrapper_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;
        tickThreshold = tickThreshold_;
    }

    function priceNotInBounds(
        uint192 price,
        uint192 peg,
        uint192 delta
    ) internal pure returns (bool) {
        return price < peg - delta || price > peg + delta;
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        try chainlinkFeed.price_(oracleTimeout) returns (uint192 price0) {
            try chainlinkFeedSecondAsset.price_(oracleTimeout) returns (uint192 price1) {
                uint192 peg = peg();
                uint192 delta = (peg * defaultThreshold) / FIX_ONE;
                if (
                    priceNotInBounds(price0, peg, delta) ||
                    priceNotInBounds(price1, peg, delta) ||
                    poolIsAwayFromOptimalPoint()
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
            //TODO need we emit it? correct in other collateral?
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return FIX_ONE; //TODO target can be other than USD, it can be EUR, GBP, etc
    }

    function poolIsAwayFromOptimalPoint() internal view returns (bool) {
        int24 tick = IUniswapV3Wrapper(address(erc20)).tick();
        return true;
//        return Math.abs(int256(tick)) < tickThreshold; //TODO handle different decimals case
        //for DAI/USDT balance point tick is -276326 and priceSqrtX96 is  79223177837511642798966
//        >>> DECIMALS_DIFF = 18 - 6
        //>>> price = 1.0001 ** (-276326) * 10 ** DECIMALS_DIFF
        //>>> price
        //0.9998026733013067

//        >>> 79223177837511642798966 / 2 ** 96
        //9.999370845341542e-07
        //>>> 79223177837511642798966 / 2 ** 96 * 10 ** 12

//        DAI/USDT pool https://etherscan.io/address/0x48da0965ab2d2cbf1c17c09cfb5cbe67ad5b1406#readContract
//        USDC/USDT pool https://etherscan.io/address/0x3416cf6c708da44db2624d63ea0aaef7113527c6#readContract
    }

    function peg() internal view returns (uint192) { //not pure but view because it can be overridden using feeds
        return FIX_ONE;
    }
}
