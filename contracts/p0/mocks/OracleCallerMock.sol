// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/libraries/Pricing.sol";
import "contracts/libraries/Fixed.sol";
import "../libraries/Oracle.sol";

contract OracleCallerMockP0 {
    using Oracle for Oracle.Info;
    using PricingLib for Price;

    Oracle.Info internal _oracle;

    constructor(Oracle.Info memory oracle_) {
        _oracle = oracle_;
    }

    function consultAaveOracle(IERC20Metadata token) external view returns (Fix) {
        Oracle.Info memory oracle = _oracle;
        return oracle.consult(Oracle.Source.AAVE, token).usd();
    }

    function consultCompoundOracle(IERC20Metadata token) external view returns (Fix) {
        Oracle.Info memory oracle = _oracle;
        return oracle.consult(Oracle.Source.COMPOUND, token).usd();
    }

    /// @return The deployment of the comptroller on this chain
    function comptroller() external view returns (IComptroller) {
        return _oracle.compound;
    }
}
