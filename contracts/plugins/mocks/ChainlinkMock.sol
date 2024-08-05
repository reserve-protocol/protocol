// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockV3Aggregator
 * @notice Based on the FluxAggregator contract
 * @notice Use this contract when you need to test
 * other contract's ability to read data from an
 * aggregator contract, but how the aggregator got
 * its answer is unimportant
 *
 * Credit: https://betterprogramming.pub/how-to-mock-chainlink-vrf-coordinator-v2-and-aggregator-v3-with-truffle-0-8-0-24353b96858e
 */
contract MockV3Aggregator is AggregatorV3Interface {
    uint256 public constant override version = 0;

    uint8 public override decimals;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    uint256 public latestRound;

    // Additional variable to be able to test invalid behavior
    uint256 public latestAnsweredRound;
    address public aggregator;
    address public priceSource;

    mapping(uint256 => int256) public getAnswer;
    mapping(uint256 => uint256) public getTimestamp;
    mapping(uint256 => uint256) private getStartedAt;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        aggregator = address(this);
        priceSource = address(this);
        updateAnswer(_initialAnswer);
    }

    function deprecate() external {
        aggregator = address(0);
    }

    function updateAnswer(int256 _answer) public {
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
        latestRound++;
        getAnswer[latestRound] = _answer;
        getTimestamp[latestRound] = block.timestamp;
        getStartedAt[latestRound] = block.timestamp;
        latestAnsweredRound = latestRound;
    }

    // used by Frax oracle
    function addRoundData(
        bool isBadData,
        uint104 low,
        uint104 high,
        uint40 timestamp
    ) public {
        latestAnswer = int104(low + high) / 2;
        latestTimestamp = block.timestamp;
        latestRound++;
        getAnswer[latestRound] = latestAnswer;
        getTimestamp[latestRound] = block.timestamp;
        getStartedAt[latestRound] = block.timestamp;
        latestAnsweredRound = latestRound;
    }

    // Additional function to be able to test invalid Chainlink behavior
    function setInvalidTimestamp() public {
        getTimestamp[latestRound] = 0;
    }

    // Additional function to be able to test invalid Chainlink behavior
    function setInvalidAnsweredRound() public {
        latestAnsweredRound = 0;
    }

    function updateRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _timestamp,
        uint256 _startedAt
    ) public {
        latestRound = _roundId;
        latestAnswer = _answer;
        latestTimestamp = _timestamp;
        getAnswer[latestRound] = _answer;
        getTimestamp[latestRound] = _timestamp;
        getStartedAt[latestRound] = _startedAt;
        latestAnsweredRound = _roundId;
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
        if (aggregator == address(0)) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(0, 0)
            }
        }
        return (
            _roundId,
            getAnswer[_roundId],
            getStartedAt[_roundId],
            getTimestamp[_roundId],
            _roundId
        );
    }

    function latestRoundData()
        external
        view
        virtual
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        if (aggregator == address(0)) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(0, 0)
            }
        }
        return (
            uint80(latestRound),
            getAnswer[latestRound],
            getStartedAt[latestRound],
            getTimestamp[latestRound],
            uint80(latestAnsweredRound)
        );
    }

    function description() external pure override returns (string memory) {
        return "v0.8/tests/MockV3Aggregator.sol";
    }
}
