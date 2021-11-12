// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "../libraries/OracleP1.sol";

contract OracleCallerMockP1 {
    using OracleP1 for OracleP1.Info;

    OracleP1.Info internal _oracle;

    constructor(OracleP1.Info memory oracle_) {
        _oracle = oracle_;
    }

    function consultAaveOracle(address token) external view returns (Fix) {
        return _oracle.consult(Oracle.Source.AAVE, token);
    }

    function consultCompoundOracle(address token) external view returns (Fix) {
        return _oracle.consult(Oracle.Source.COMPOUND, token);
    }

    /// @return The deployment of the comptroller on this chain
    function comptroller() external view returns (IComptroller) {
        return _oracle.compound;
    }
}
