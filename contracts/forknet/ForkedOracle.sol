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
    uint8 public decimals;
    int256 private answerInternal;
    string public description;

    function setData(
        uint8 _decimals,
        int256 _answer,
        string memory _description
    ) external {
        decimals = _decimals;
        answerInternal = _answer;
        description = _description;
    }

    function aggregator() external pure returns (address) {
        return address(0x1); // Anything other than 0x0 is fine.
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
