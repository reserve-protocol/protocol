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
    UoA public immutable override uoa;

    CollateralStatus private _collateralStatus;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_,
        UoA uoa_
    ) AssetP0(erc20_, main_, oracle_) {
        uoa = uoa_;
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

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral, IMain) external virtual override {}

    /// @return The asset's default status
    function status() external view virtual override returns (CollateralStatus) {
        return _collateralStatus;
    }

    /// @return {attoUoA/qTok} The price of the asset in its unit of account
    function priceUoA() public view virtual override returns (Fix) {
        if (uoa == UoA.USD) {
            return priceUSD();
        } else if (uoa == UoA.EUR) {
            return _priceEUR();
        } else if (uoa == UoA.BTC) {
            return _priceBTC();
        } else if (uoa == UoA.ETH) {
            return _priceETH();
        } else if (uoa == UoA.XAU) {
            return _priceXAU();
        }
        return FIX_ZERO;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(AssetP0, IAsset) returns (bool) {
        return true;
    }

    // Thse are just examples of what it would look like to add other units of account

    function _priceEUR() internal view virtual returns (Fix) {
        return FIX_ZERO;
    }

    function _priceBTC() internal view virtual returns (Fix) {
        return FIX_ZERO;
    }

    function _priceETH() internal view virtual returns (Fix) {
        return FIX_ZERO;
    }

    function _priceXAU() internal view virtual returns (Fix) {
        return FIX_ZERO;
    }
}
