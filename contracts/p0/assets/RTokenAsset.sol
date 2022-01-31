// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Asset.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) AssetP0(erc20_, main_, oracle_) {}

    /// @return {UoA/rTok}
    function price() public view override returns (Fix) {
        return main.rTokenPrice();
    }
}
