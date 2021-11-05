// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/Oracle.sol";

contract OracleCallerMockP0 {
    using Oracle for Oracle.Info;

    Oracle.Info internal _oracle;

    constructor(Oracle.Info memory oracle_) {
        _oracle = oracle_;
    }

    /// @return The price in USD of `token` on Aave {UNITS}
    function consultAaveOracle(address token) external view returns (uint256) {
        return _oracle.consultAave(token);
    }

    /// @return The price in USD of `token` on Compound {UNITS}
    function consultCompoundOracle(address token) external view returns (uint256) {
        return _oracle.consultCompound(token);
    }

    /// @return The deployment of the comptroller on this chain
    function comptroller() external view returns (IComptroller) {
        return _oracle.compound;
    }
}
