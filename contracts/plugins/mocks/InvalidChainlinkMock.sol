// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ChainlinkMock.sol";

/**
 * @title OOGMockV3Aggregator
 * @notice Use this contract when you need to test our of gas errors
 * on Chainlink feeds
 *
 */
contract InvalidMockV3Aggregator is MockV3Aggregator {
    bool public simplyRevert;
    bool public revertWithExplicitError;

    constructor(uint8 _decimals, int256 _initialAnswer)
        MockV3Aggregator(_decimals, _initialAnswer)
    {}

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRoundyarn
        )
    {
        if (simplyRevert) {
            revert(); // Revert with no reason
        } else if (revertWithExplicitError) {
            revert("oracle explicit error"); // Revert with explicit reason
        } else {
            // Run out of gas
            this.infiniteLoop{ gas: 10 }();
        }
        return (
            uint80(latestRound),
            getAnswer[latestRound],
            block.timestamp,
            getTimestamp[latestRound],
            uint80(latestRound)
        );
    }

    function setSimplyRevert(bool on) external {
        simplyRevert = on;
    }

    function setRevertWithExplicitError(bool on) external {
        revertWithExplicitError = on;
    }

    function infiniteLoop() external pure {
        uint256 i = 0;
        uint256[1] memory array;
        while (true) {
            array[0] = i;
            i++;
        }
    }
}
