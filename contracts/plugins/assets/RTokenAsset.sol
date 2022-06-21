// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    // solhint-disable no-empty-blocks
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) Asset(main_, erc20_, maxTradeVolume_) {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/rTok}
    function price() public view override returns (uint192) {
        return main.rToken().price();
    }
}
