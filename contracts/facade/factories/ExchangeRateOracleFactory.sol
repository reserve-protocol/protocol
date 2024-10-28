// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { FIX_ONE, divuu } from "../../libraries/Fixed.sol";

// weird circular inheritance preventing us from using proper IRToken, not worth figuring out
interface IMinimalRToken {
    function basketsNeeded() external view returns (uint192);

    function totalSupply() external view returns (uint256);
}

contract ExchangeRateOracle {
    error MissingRToken();

    address public immutable rToken;

    constructor(address _rToken) {
        // allow address(0)
        rToken = _rToken;
    }

    function exchangeRate() public view returns (uint256) {
        address _rToken = rToken;
        if (_rToken == address(0)) revert MissingRToken();

        uint256 supply = IMinimalRToken(_rToken).totalSupply();
        if (supply == 0) return FIX_ONE;

        return divuu(uint256(IMinimalRToken(_rToken).basketsNeeded()), supply);
    }

    // basic chainlink interface sufficient for Morpho
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
        return (0, int256(exchangeRate()), 0, 0, 0);
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }
}

/**
 * @title ExchangeRateOracleFactory
 * @notice An immutable factory for Exchange Rate Oracles
 */
contract ExchangeRateOracleFactory {
    error OracleAlreadyDeployed();

    event OracleDeployed(address indexed rToken, address indexed oracle);

    // {rtoken} => {oracle}
    mapping(address => ExchangeRateOracle) public oracles;

    function deployOracle(address rToken) external returns (address) {
        if (address(oracles[rToken]) != address(0)) revert OracleAlreadyDeployed();
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
