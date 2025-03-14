// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../vendor/IMidasDataFeed.sol";
import "../vendor/DecimalsCorrectionLibrary.sol";

contract MockMidasDataFeed is IMidasDataFeed {
    using DecimalsCorrectionLibrary for uint256;

    AggregatorV3Interface public aggregator;

    uint256 public healthyDiff;
    int256 public minExpectedAnswer;
    int256 public maxExpectedAnswer;

    function initialize(
        address, // _ac
        address _aggregator,
        uint256 _healthyDiff,
        int256 _minExpectedAnswer,
        int256 _maxExpectedAnswer
    ) external override {
        require(_aggregator != address(0), "DF: invalid address");
        require(_healthyDiff > 0, "DF: invalid diff");
        require(_minExpectedAnswer > 0, "DF: invalid min exp. price");
        require(_maxExpectedAnswer > 0, "DF: invalid max exp. price");
        require(_maxExpectedAnswer > _minExpectedAnswer, "DF: invalid exp. prices");

        aggregator = AggregatorV3Interface(_aggregator);

        healthyDiff = _healthyDiff;
        minExpectedAnswer = _minExpectedAnswer;
        maxExpectedAnswer = _maxExpectedAnswer;
    }

    function changeAggregator(address _aggregator) external override {
        require(_aggregator != address(0), "invalid aggregator address");
        aggregator = AggregatorV3Interface(_aggregator);
    }

    function getDataInBase18() external view returns (uint256 answer) {
        (, answer) = _getDataInBase18();
    }

    function feedAdminRole() external pure override returns (bytes32) {
        return keccak256("ADMIN_ROLE");
    }

    function _getDataInBase18() private view returns (uint80 roundId, uint256 answer) {
        uint8 decimals = aggregator.decimals();
        (uint80 _roundId, int256 _answer, , uint256 updatedAt, ) = aggregator.latestRoundData();
        require(_answer > 0, "DF: feed is deprecated");
        require(
            // solhint-disable-next-line not-rely-on-time
            block.timestamp - updatedAt <= healthyDiff &&
                _answer >= minExpectedAnswer &&
                _answer <= maxExpectedAnswer,
            "DF: feed is unhealthy"
        );
        roundId = _roundId;
        answer = uint256(_answer).convertToBase18(decimals);
    }
}
