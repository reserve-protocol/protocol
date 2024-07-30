// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { divuu } from "../../libraries/Fixed.sol";

// weird circular inheritance preventing us from using proper IRToken, not worth figuring out
interface IRToken {
    function basketsNeeded() external view returns (uint192);

    function totalSupply() external view returns (uint256);
}

contract CurveOracle {
    IRToken public immutable rToken;

    constructor(IRToken _rToken) {
        rToken = _rToken;
    }

    function exchangeRate() external view returns (uint256) {
        return divuu(uint256(rToken.basketsNeeded()), rToken.totalSupply());
    }
}

/**
 * @title CurveOracleFactory
 * @notice An immutable factory for Curve oracles
 */
contract CurveOracleFactory {
    error CurveOracleAlreadyDeployed();

    event CurveOracleDeployed(address indexed rToken, address indexed curveOracle);

    mapping(IRToken => CurveOracle) public curveOracles;

    function deployCurveOracle(IRToken rToken) external returns (address) {
        if (address(curveOracles[rToken]) != address(0)) revert CurveOracleAlreadyDeployed();
        CurveOracle curveOracle = new CurveOracle(rToken);
        curveOracle.exchangeRate(); // ensure it works
        curveOracles[rToken] = curveOracle;
        emit CurveOracleDeployed(address(rToken), address(curveOracle));
        return address(curveOracle);
    }
}
