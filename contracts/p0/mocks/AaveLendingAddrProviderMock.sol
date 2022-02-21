// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/abstract/AaveOracleMixin.sol";

contract AaveLendingAddrProviderMockP0 is ILendingPoolAddressesProvider {
    IAaveOracle private _aaveOracle;

    constructor(address aaveOracleAddress) {
        _aaveOracle = IAaveOracle(aaveOracleAddress);
    }

    function getPriceOracle() external view override returns (IAaveOracle) {
        return _aaveOracle;
    }
}
