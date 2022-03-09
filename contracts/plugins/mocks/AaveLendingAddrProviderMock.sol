// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";

contract AaveLendingAddrProviderMock is ILendingPoolAddressesProvider {
    IAaveOracle private _aaveOracle;

    constructor(address aaveOracleAddress) {
        _aaveOracle = IAaveOracle(aaveOracleAddress);
    }

    function getPriceOracle() external view returns (IAaveOracle) {
        return _aaveOracle;
    }
}
