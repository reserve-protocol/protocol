// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface FraxAggregatorV3Interface is AggregatorV3Interface {
    function priceSource() external view returns (address);

    function getPrices()
        external
        view
        returns (
            bool _isBadData,
            uint256 _priceLow,
            uint256 _priceHigh
        );

    function addRoundData(
        bool _isBadData,
        uint104 _priceLow,
        uint104 _priceHigh,
        uint40 _timestamp
    ) external;
}
