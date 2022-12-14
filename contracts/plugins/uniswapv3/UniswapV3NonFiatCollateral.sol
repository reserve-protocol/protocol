// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "./IUniswapV3Wrapper.sol";
import "./UniswapV3Collateral.sol";

/**
    @title Uniswap V3 Non Fiat Collateral
    @notice Collateral plugin for non-fiat Uniswap V3 positions
    @notice Requires Uniswap V3 Wrapper to be deployed first to wrap the position used
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3NonFiatCollateral is UniswapV3Collateral {
    using OracleLib for AggregatorV3Interface;

    constructor(
        uint192 fallbackPrice_,
        uint192 fallbackPriceSecondAsset_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV3Wrapper uniswapV3Wrapper_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
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
    {}

    //TODO refresh

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return strictPrice();
    }
}
