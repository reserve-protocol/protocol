// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";

/// A system component that provides easy lookup of token prices in multiple feeds
contract OracleP1 is ComponentP1, IOracle {
    using FixLib for uint192;

    enum Feed {
        CHAINLINK // for now just chainlink. more later
    }

    mapping(bytes32 => Feed) public feeds; // defaults to Feed.CHAINLINK

    mapping(bytes32 => AggregatorV3Interface) public chainlink;

    function init(IMain main_, AggregatorV3Interface rsrChainlinkFeed) external initializer {
        __Component_init(main_);
        _setChainlinkFeed(bytes32(bytes("RSR")), rsrChainlinkFeed);
    }

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    /// @return {USD/tok}
    function priceUSD(bytes32 symbolBytes) external view returns (uint192) {
        Feed feed = feeds[symbolBytes];

        // Only understands Chainlink
        if (uint256(feed) > uint256(Feed.CHAINLINK)) {
            revert MissingPriceFeed(symbolBytes);
        }

        // Chainlink
        AggregatorV3Interface chainlinkFeed = chainlink[symbolBytes];
        if (address(chainlinkFeed) == address(0)) revert MissingPriceFeed(symbolBytes);
        (
            uint80 roundId,
            int256 price, /*uint startedAt*/
            ,
            uint256 updateTime,
            uint80 answeredInRound
        ) = chainlinkFeed.latestRoundData();

        if (updateTime == 0 || answeredInRound < roundId) {
            revert StaleChainlinkPrice(symbolBytes);
        }

        // {USD/tok}
        uint192 scaledPrice = shiftl_toFix(uint256(price), 18 - int8(chainlinkFeed.decimals()));

        if (scaledPrice.eq(FIX_ZERO)) revert PriceOutsideRange(symbolBytes);
        return scaledPrice;
    }

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    /// @return {EUR/tok}
    function priceEUR(bytes32 symbolBytes) external pure returns (uint192) {
        revert MissingPriceFeed(symbolBytes);
    }

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    function setChainlinkFeed(bytes32 symbolBytes, AggregatorV3Interface chainlinkFeed)
        external
        governance
    {
        _setChainlinkFeed(symbolBytes, chainlinkFeed);
    }

    /// @param symbolBytes e.g. bytes32(bytes("ETH"))
    function _setChainlinkFeed(bytes32 symbolBytes, AggregatorV3Interface chainlinkFeed) internal {
        chainlink[symbolBytes] = chainlinkFeed;
        emit ChainlinkFeedSet(symbolBytes, chainlinkFeed);
    }
}
