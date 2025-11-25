// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title GenericOracleMock
 * @notice Simple mock implementation compatible with Redstone oracles
 * @dev Mirrors EACAggregatorProxyMock behavior for testing
 */
contract GenericOracleMock is AggregatorV3Interface {
    uint8 private _decimals;

    // Current round data
    uint256 public __latestRound;
    int256 public __latestAnswer;
    uint256 public __latestTimestamp;
    uint256 public __latestAnsweredRound;

    // Historical round data
    mapping(uint256 => int256) public __getAnswer;
    mapping(uint256 => uint256) public __getTimestamp;
    mapping(uint256 => uint256) private __getStartedAt;

    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        updateAnswer(initialAnswer);
    }

    /**
     * @notice Initialize storage after bytecode replacement
     * @dev Call this after hardhat_setCode to properly initialize storage at target address
     */
    function initialize(uint8 decimals_, int256 initialAnswer) external {
        _decimals = decimals_;
        __latestRound = 0;
        __latestAnswer = 0;
        __latestTimestamp = 0;
        __latestAnsweredRound = 0;
        updateAnswer(initialAnswer);
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external pure override returns (string memory) {
        return "GenericOracleMock";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function updateAnswer(int256 _answer) public {
        __latestAnswer = _answer;
        __latestTimestamp = block.timestamp;
        __latestRound++;
        __getAnswer[__latestRound] = _answer;
        __getTimestamp[__latestRound] = block.timestamp;
        __getStartedAt[__latestRound] = block.timestamp;
        __latestAnsweredRound = __latestRound;
    }

    function updateRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _timestamp,
        uint256 _startedAt
    ) public {
        __latestRound = _roundId;
        __latestAnswer = _answer;
        __latestTimestamp = _timestamp;
        __getAnswer[__latestRound] = _answer;
        __getTimestamp[__latestRound] = _timestamp;
        __getStartedAt[__latestRound] = _startedAt;
        __latestAnsweredRound = _roundId;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            uint80(__latestRound),
            __getAnswer[__latestRound],
            __getStartedAt[__latestRound],
            __getTimestamp[__latestRound],
            uint80(__latestAnsweredRound)
        );
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            _roundId,
            __getAnswer[_roundId],
            __getStartedAt[_roundId],
            __getTimestamp[_roundId],
            _roundId
        );
    }
}
