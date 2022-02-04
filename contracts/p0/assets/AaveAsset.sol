// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/assets/abstract/Asset.sol";
import "contracts/p0/assets/abstract/AaveOracleMixin.sol";

contract AaveAssetP0 is AaveOracleMixinP0, AssetP0 {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) AaveOracleMixinP0(comptroller_, aaveLendingPool_) AssetP0(erc20_) {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (Fix) {
        return consultOracle(erc20);
    }
}
