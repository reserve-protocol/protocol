// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "../libraries/Oracle.sol";

contract OracleCallerMockP1 {
    using Oracle for Oracle.Info;

    Oracle.Info internal _oracle;

    constructor(Oracle.Info memory oracle_) {
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
