// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface AggregatorV3MixedInterface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function aggregator() external view returns (address);
}

contract ForkedOracle is AggregatorV3MixedInterface {
    address public constant aggregator = address(0x1);
    string public constant description = "FORKED";

    uint8 public decimals;
    int256 private answerInternal;

    function setData(uint8 _decimals, int256 _answer) external {
        decimals = _decimals;
        answerInternal = _answer;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        roundId = 1;
        answer = answerInternal;
        startedAt = 0;
        updatedAt = block.timestamp - 1;
        answeredInRound = 1;
    }
}
