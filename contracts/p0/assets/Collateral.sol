// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CollateralP0
 * @notice A general collateral type to be extended by more specific collateral types.
 */
contract CollateralP0 is ICollateral, Context, AssetP0 {
    CollateralStatus private _collateralStatus;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) AssetP0(erc20_, main_, oracle_) {
        _collateralStatus = CollateralStatus.SOUND;
    }

    // solhint-disable no-empty-blocks

    /// Extenders of this class can locate necessary block-updates here
    function forceUpdates() public virtual override {}

    /// Disable the collateral directly
    function disable() external virtual override {
        require(_msgSender() == address(main) || _msgSender() == main.owner(), "main or its owner");
        _collateralStatus = CollateralStatus.DISABLED;
    }

    /// @return The asset's default status
    function status() external view virtual override returns (CollateralStatus) {
        return _collateralStatus;
    }

    /// @return {attoRef/qTok} The price of the asset in its unit of account
    function referencePrice() public view virtual override returns (Fix) {
        return price();
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(AssetP0, IAsset) returns (bool) {
        return true;
    }
}
