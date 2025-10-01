// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { ExchangeRateOracle } from "./ExchangeRateOracle.sol";
import { ReferenceRateOracle } from "./ReferenceRateOracle.sol";

/**
 * @title OracleFactory
 * @notice An immutable factory for RToken Exchange Rate Oracles
 */
contract OracleFactory {
    struct Oracles {
        ExchangeRateOracle exchangeRateOracle;
        ReferenceRateOracle referenceRateOracle;
    }

    error OracleAlreadyDeployed(address rToken);

    event OracleDeployed(address indexed rToken, Oracles oracles);

    // {rtoken} => {oracle}
    mapping(address => Oracles) public oracleRegistry;

    /// @param rToken The RToken to deploy oracles for
    function deployOracle(address rToken) external returns (Oracles memory oracles) {
        if (
            rToken == address(0) || address(oracleRegistry[rToken].exchangeRateOracle) != address(0)
        ) {
            revert OracleAlreadyDeployed(rToken);
        }

        ExchangeRateOracle eOracle = new ExchangeRateOracle(rToken);
        ReferenceRateOracle rOracle = new ReferenceRateOracle(rToken);

        oracles = Oracles({ exchangeRateOracle: eOracle, referenceRateOracle: rOracle });

        eOracle.latestRoundData();
        rOracle.latestRoundData();

        oracleRegistry[rToken] = oracles;
        emit OracleDeployed(rToken, oracles);
    }
}
