// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Asset.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";

contract AavePricedAsset is AaveOracleMixin, Asset {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) Asset(erc20_, maxTradeVolume_) AaveOracleMixin(comptroller_, aaveLendingPool_) {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return consultOracle(erc20);
    }
}
