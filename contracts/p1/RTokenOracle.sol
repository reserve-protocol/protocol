// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../interfaces/IBasketHandler.sol";

import "hardhat/console.sol";

// This interface is here temporarily
interface ModifiedChainlinkInterface {
    function latestAnswer() external returns (int256);

    function latestRoundData()
        external
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title RToken Oracle
 * @notice This is just a temporary testing ground for oracle actions!!
 *         DO NOT USE!!
 */
contract RTokenOracle is ModifiedChainlinkInterface {
    IBasketHandler basketHandler;

    AggregatorV3Interface chainlinkOracle;

    int256 cachedPrice;
    uint256 cachedAt;

    uint256 CACHE_TIMEOUT;

    constructor(IBasketHandler _basketHandler) {
        basketHandler = _basketHandler; // msg.sender

        CACHE_TIMEOUT = 15 minutes;
    }

    function _updateCachedPrice() internal {
        (uint192 low, uint192 high) = basketHandler.price();

        // if (low == 0 && high == FIX_MAX) {
        //     (low, high) = basketHandler.lotPrice();
        //     console.log("using lot price");
        // }

        cachedPrice = int256((uint256(low) + uint256(high)) / 2);
        cachedAt = block.timestamp;
    }

    function forceUpdatePrice() external {
        _updateCachedPrice();
    }

    function setChainlinkOracle(address _chainlinkOracle) external {
        require(msg.sender == address(basketHandler), "!basketHandler"); // just thinking

        chainlinkOracle = AggregatorV3Interface(_chainlinkOracle);
    }

    function latestRoundData()
        external
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        if (address(chainlinkOracle) != address(0)) {
            return chainlinkOracle.latestRoundData();
        }

        // Situations that require an update, from most common to least common.
        if (
            cachedAt + CACHE_TIMEOUT <= block.timestamp // Cache Timeout
            // !basketHandler.fullyCollateralized() // Basket is not fully collateralized
            // TODO: Nonce difference
            // TODO: Should we also check for ready?
            // TODO: ..or status for that matter?
        ) {
            _updateCachedPrice();
        }

        return (0, cachedPrice, 0, cachedAt, 0);
    }

    function latestAnswer() external returns (int256 latestPrice) {
        (, latestPrice, , , ) = this.latestRoundData();
    }
}
