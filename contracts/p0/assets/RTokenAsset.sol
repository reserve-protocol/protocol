// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/assets/abstract/Asset.sol";
import "contracts/p0/interfaces/IMain.sol";

contract RTokenAssetP0 is AssetP0 {
    IMain public immutable main;

    constructor(
        IERC20Metadata erc20_,
        Fix maxAuctionSize_,
        IMain main_
    ) AssetP0(erc20_, maxAuctionSize_) {
        main = main_;
    }

    /// @return {UoA/rTok}
    function price() public view virtual override returns (Fix) {
        return main.rTokenPrice();
    }
}
