// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    IMain public immutable main;

    constructor(
        IERC20Metadata erc20_,
        uint256 maxTradeVolume_,
        IMain main_
    ) Asset(erc20_, maxTradeVolume_) {
        main = main_;
    }

    /// @return {UoA/rTok}
    function price() public view override returns (int192) {
        return main.rToken().price();
    }
}
