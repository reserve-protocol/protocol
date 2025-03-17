// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface IMidasDataFeed {
    /**
     * @notice upgradeable pattern contract`s initializer
     * @param _ac MidasAccessControl contract address
     * @param _aggregator AggregatorV3Interface contract address
     * @param _healthyDiff max. staleness time for data feed answers
     * @param _minExpectedAnswer min.expected answer value from data feed
     * @param _maxExpectedAnswer max.expected answer value from data feed
     */
    function initialize(
        address _ac,
        address _aggregator,
        uint256 _healthyDiff,
        int256 _minExpectedAnswer,
        int256 _maxExpectedAnswer
    ) external;

    /**
     * @notice updates `aggregator` address
     * @param _aggregator new AggregatorV3Interface contract address
     */
    function changeAggregator(address _aggregator) external;

    /**
     * @notice fetches answer from aggregator
     * and converts it to the base18 precision
     * @return answer fetched aggregator answer
     */
    function getDataInBase18() external view returns (uint256 answer);

    /**
     * @dev describes a role, owner of which can manage this feed
     * @return role descriptor
     */
    function feedAdminRole() external view returns (bytes32);
}
