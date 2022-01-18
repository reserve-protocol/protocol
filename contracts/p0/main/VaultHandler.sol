// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/libraries/CommonErrors.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";

/**
 * @title VaultHandler
 * @notice Tries to ensure the current vault is valid at all times.
 */
contract VaultHandlerP0 is Pausable, Mixin, SettingsHandlerP0, RevenueDistributorP0, IVaultHandler {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    IVault[] public vaults;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0)
    {
        super.init(args);
        if (args.vault.collateralStatus() != CollateralStatus.SOUND) {
            revert CommonErrors.UnsoundVault();
        }

        vaults.push(args.vault);
    }

    function poke() public virtual override notPaused {
        super.poke();
        _updateCollateralStatuses();
        _tryEnsureValidVault();
    }

    function switchVault(IVault vault_) external override onlyOwner {
        _switchVault(vault_);
    }

    function vault() public view override returns (IVault) {
        return vaults[vaults.length - 1];
    }

    function fullyCapitalized() public view override returns (bool) {
        // TODO
        // Sum assets in terms of reference units and compare against vault targets given by BUs
    }

    function numVaults() external view override returns (uint256) {
        return vaults.length;
    }

    /// {qRTok} -> {qBU}
    function toBUs(uint256 amount) public view override returns (uint256) {
        return baseFactor().mulu(amount).floor();
    }

    /// {qBU} -> {qRTok}
    function fromBUs(uint256 amtBUs) public view override returns (uint256) {
        return divFix(amtBUs, baseFactor()).floor();
    }

    /// @return {none}
    function baseFactor() public view override returns (Fix) {
        Fix supply = toFix(rToken().totalSupply()); // {qRTok}
        Fix melted = toFix(rToken().totalMelted()); // {qRTok}
        return supply.eq(FIX_ZERO) ? FIX_ONE : supply.plus(melted).div(supply);
    }

    // ==== Internal ====

    function _updateCollateralStatuses() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
    }

    function _tryEnsureValidVault() internal {
        if (vault().collateralStatus() == CollateralStatus.DISABLED) {
            (bool hasNext, IVault nextVault) = _selectNextVault();
            if (hasNext) {
                _switchVault(nextVault);
            }
        }
    }

    function _switchVault(IVault vault_) internal {
        emit NewVaultSet(address(vault()), address(vault_));
        vaults.push(vault_);
    }

    /// Redeems up to `maxBUs` basket units, redeeming from the oldest vault first.
    /// @param allowCurrentVault Whether to redeem from the current vault in addition to old vaults.
    /// @return redeemedBUs How many BUs were actually redeemed
    function _redeemFromOldVaults(
        address recipient,
        uint256 maxBUs,
        bool allowCurrentVault
    ) internal returns (uint256 redeemedBUs) {
        uint256 endIndex = allowCurrentVault ? vaults.length : vaults.length - 1;
        for (uint256 i = 0; i < endIndex && redeemedBUs < maxBUs; i++) {
            redeemedBUs += _redeemFrom(vaults[i], recipient, maxBUs - redeemedBUs);
        }
    }

    // ==== Private ====

    /// @dev You should probably never call this. Consider using _redeemFromOldVaults instead.
    /// @return toRedeem How many BUs were redeemed
    function _redeemFrom(
        IVault vault_,
        address recipient,
        uint256 maxToRedeem
    ) private returns (uint256 toRedeem) {
        toRedeem = Math.min(vault_.basketUnits(address(rToken())), maxToRedeem);
        if (toRedeem > 0) {
            rToken().withdrawBUs(vault_, address(this), toRedeem);
            vault_.redeem(recipient, toRedeem);
        }
    }

    /// @return A vault from the list of backup vaults that is not defaulting
    function _selectNextVault() private view returns (bool, IVault) {
        Fix maxPrice;
        uint256 indexMax;
        IVault[] memory backups = vault().getBackups();

        // Find the highest-value backup that doesn't contain defaulting collateral
        for (uint256 i = 0; i < backups.length; i++) {
            if (backups[i].collateralStatus() == CollateralStatus.SOUND) {
                Fix price = backups[i].basketPrice(); // {attoUSD/BU}

                // See if it has the highest basket
                if (price.gt(maxPrice)) {
                    maxPrice = price;
                    indexMax = i;
                }
            }
        }

        if (maxPrice.eq(FIX_ZERO)) {
            return (false, IVault(address(0)));
        }
        return (true, backups[indexMax]);
    }
}
