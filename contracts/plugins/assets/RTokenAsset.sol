// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    IMain public immutable main;

    constructor(
        IERC20Metadata erc20_,
        Fix maxAuctionSize_,
        IMain main_
    ) Asset(erc20_, maxAuctionSize_) {
        main = main_;
    }

    /// @return {UoA/rTok}
    function price() public view override returns (Fix) {
        return main.rToken().price();
    }
}
