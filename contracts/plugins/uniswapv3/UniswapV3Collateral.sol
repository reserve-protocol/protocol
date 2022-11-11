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
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            IERC20Metadata(erc20_),
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(
            address(chainlinkFeedSecondAsset_) != address(0),
            "missing chainlink feed for second asset in pair"
        );
        chainlinkFeedSecondAsset = chainlinkFeedSecondAsset_;
    }

    /// Can return 0, can revert
    /// Shortcut for price(false)
    /// @return {UoA/tok} The current price(), without considering fallback prices
    function strictPrice() external view override returns (uint192) {
        (
            uint256 amount0,
            uint256 amount1,
            ,
        ) = IUniswapV3Wrapper(address(erc20)).principal();
        return uint192((chainlinkFeed.price(oracleTimeout) * amount0) + (chainlinkFeedSecondAsset.price(oracleTimeout) * amount1));
    }

    function getClaimCalldata()
        external
        view
        virtual
        override
        returns (address _to, bytes memory _cd)
    {
        _to = address(erc20);
        _cd = abi.encodeWithSignature("collect(address)", msg.sender);
    }
    //TODO RefPerTok() always equals 1 but we need to implement check
}
