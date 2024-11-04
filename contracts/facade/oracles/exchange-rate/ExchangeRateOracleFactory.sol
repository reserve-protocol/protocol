// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { ExchangeRateOracle } from "./ExchangeRateOracle.sol";

/**
 * @title ExchangeRateOracleFactory
 * @notice An immutable factory for RToken Exchange Rate Oracles
 */
contract ExchangeRateOracleFactory {
    error OracleAlreadyDeployed(address oracle);

    event OracleDeployed(address indexed rToken, address indexed oracle);

    // {rtoken} => {oracle}
    mapping(address => ExchangeRateOracle) public oracles;

    function deployOracle(address rToken) external returns (address) {
        if (address(oracles[rToken]) != address(0)) {
            revert OracleAlreadyDeployed(address(oracles[rToken]));
        }

        ExchangeRateOracle oracle = new ExchangeRateOracle(rToken);

        if (rToken != address(0)) {
            oracle.exchangeRate();
            oracle.latestRoundData();
            oracle.decimals();
        }

        oracles[rToken] = oracle;
        emit OracleDeployed(address(rToken), address(oracle));

        return address(oracle);
    }
}
