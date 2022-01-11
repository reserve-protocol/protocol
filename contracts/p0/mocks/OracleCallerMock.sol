// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IOracle.sol";

contract OracleCallerMockP0 {
    IOracle internal _oracle;

    constructor(IOracle oracle_) {
        _oracle = oracle_;
    }

    function consult(IERC20Metadata token) external view returns (Fix) {
        return _oracle.consult(token);
    }
}
