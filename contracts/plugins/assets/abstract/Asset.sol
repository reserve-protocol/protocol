// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";

abstract contract AssetP0 is IAsset {
    IERC20Metadata public immutable override erc20;

    Fix public immutable override maxAuctionSize; // {UoA}

    constructor(IERC20Metadata erc20_, Fix maxAuctionSize_) {
        erc20 = erc20_;
        maxAuctionSize = maxAuctionSize_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (Fix);

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override returns (bool) {
        return false;
    }
}
