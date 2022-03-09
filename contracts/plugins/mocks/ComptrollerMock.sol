// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "./ERC20Mock.sol";

contract ComptrollerMock is IComptroller {
    ICompoundOracle private _compoundOracle;

    mapping(address => uint256) public compBalances;

    ERC20Mock public compToken;

    constructor(address compoundOracleAddress) {
        _compoundOracle = ICompoundOracle(compoundOracleAddress);
    }

    function oracle() external view returns (ICompoundOracle) {
        return _compoundOracle;
    }

    function setCompToken(address compToken_) external {
        compToken = ERC20Mock(compToken_);
    }

    function setRewards(address recipient, uint256 amount) external {
        compBalances[recipient] = amount;
    }

    function claimComp(address holder) external {
        // Mint amount and update internal balances
        if (address(compToken) != address(0)) {
            uint256 amount = compBalances[holder];
            compBalances[holder] = 0;
            compToken.mint(holder, amount);
        }
    }
}
