// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";

contract COMPAssetP0 is Asset {
    // solhint-disable-next-line no-empty-blocks
    constructor(address erc20_, IMain main_) Asset(erc20_, main_, Oracle.Source.COMPOUND) {}
}
