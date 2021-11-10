// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../libraries/Oracle.sol";

contract ComptrollerMockP0 is IComptroller {
    ICompoundOracle private _compoundOracle;

    mapping(address => uint256) private _compBalances;

    constructor(address compoundOracleAddress) {
        _compoundOracle = ICompoundOracle(compoundOracleAddress);
    }

    function oracle() external view override returns (ICompoundOracle) {
        return _compoundOracle;
    }

    function claimComp(address holder) external view override {
        _compBalances[holder];
    }
}
