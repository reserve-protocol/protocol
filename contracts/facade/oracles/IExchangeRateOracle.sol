// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface IExchangeRateOracle is AggregatorV3Interface {
    function exchangeRate() external view returns (uint256);
}
