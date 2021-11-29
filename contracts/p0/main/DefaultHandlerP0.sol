// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/AssetRegistryP0.sol";
import "contracts/p0/main/MoodyP0.sol";
import "contracts/p0/main/SettingsHandlerP0.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistryP0.sol";
import "./MoodyP0.sol";
import "./SettingsHandlerP0.sol";
import "./VaultHandlerP0.sol";

/**
 * @title DefaultHandler
 * @notice Handles the process of default detection on the collateral as well as
 *    selection of the next vault.
 */
contract DefaultHandlerP0 is
    Pausable,
    Mixin,
    MoodyP0,
    AssetRegistryP0,
    SettingsHandlerP0,
    VaultHandlerP0,
    IDefaultHandler
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    mapping(ICollateral => Fix) private _lastRatesUSD; // {attoUSD/qtok}

    // TODO: Need `init?`

    function poke() public virtual override notPaused {
        ICollateral[] memory softDefaulting = _checkForSoftDefault();

        if (softDefaulting.length == 0) {
            // Default expires before 24h
            _setMood(fullyCapitalized() ? Mood.CALM : Mood.TRADING);
        } else if (_mood == Mood.DOUBT && block.timestamp >= _lastMoodChange + _config.defaultDelay) {
            // If mood is DOUBT for >24h (default delay), switch vaults

            for (uint256 i = 0; i < softDefaulting.length; i++) {
                _unapproveCollateral(softDefaulting[i]); // TODO Unapprove only per-collateral defaulting, not all
            }

            IVault nextVault = _selectBackupVaultFromApprovedCollateral();
            _switchVault(nextVault);
            _setMood(Mood.TRADING);
        } else if (_mood == Mood.CALM || _mood == Mood.TRADING) {
            _setMood(Mood.DOUBT);
        }
    }

    /// Checks for hard default in a vault by inspecting the redemption rates of collateral tokens
    /// @return defaulting All hard-defaulting tokens
    function _checkForHardDefault() internal returns (ICollateral[] memory defaulting) {
        ICollateral[] memory collateral = new ICollateral[](_approvedCollateral.length());
        uint256 count;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            ICollateral c = ICollateral(_approvedCollateral.at(i));
            if (c.rateUSD().lt(_lastRatesUSD[c])) {
                collateral[count] = c;
                count++;
            } else {
                _lastRatesUSD[c] = c.rateUSD();
            }
        }
        defaulting = new ICollateral[](count);
        for (uint256 i = 0; i < count; i++) {
            defaulting[i] = collateral[i];
        }
    }

    /// Checks for soft default in a vault by checking oracle values for all fiatcoins in the vault
    /// @return defaulting All soft-defaulting tokens
    function _checkForSoftDefault() internal view returns (ICollateral[] memory defaulting) {
        Fix defaultThreshold = _defaultThreshold();
        ICollateral[] memory collateral = new ICollateral[](_approvedCollateral.length());
        uint256 count;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            ICollateral c = ICollateral(_approvedCollateral.at(i));

            Fix price = c.fiatcoinPriceUSD(address(this)).shiftLeft(int8(c.fiatcoinDecimals()));
            if (price.lt(defaultThreshold)) {
                collateral[count] = c;
                count++;
            }
        }
        defaulting = new ICollateral[](count);
        for (uint256 i = 0; i < count; i++) {
            defaulting[i] = collateral[i];
        }
    }

    /// @return A vault from the list of backup vaults that is not defaulting, or the zero address
    function _selectBackupVaultFromApprovedCollateral() internal view returns (IVault) {
        Fix maxRate;
        uint256 indexMax = 0;
        IVault[] memory backups = vault.getBackups();

        // Loop through backups to find the highest value one that doesn't contain defaulting collateral
        for (uint256 i = 0; i < backups.length; i++) {
            if (_checkForSoftDefault().length == 0 && _vaultIsOnlyApprovedCollateral(backups[i])) {
                Fix rate = backups[i].basketRate(); // {USD}

                // See if it has the highest basket rate
                if (rate.gt(maxRate)) {
                    maxRate = rate;
                    indexMax = i;
                }
            }
        }

        if (maxRate.eq(FIX_ZERO)) {
            return IVault(address(0));
        }
        return backups[indexMax];
    }

    /// @return Whether a vault consists only of approved collateral
    function _vaultIsOnlyApprovedCollateral(IVault vault) private view returns (bool) {
        for (uint256 i = 0; i < vault.size(); i++) {
            bool found = false;
            for (uint256 j = 0; j < _approvedCollateral.length(); j++) {
                if (address(vault.collateralAt(i)) == _approvedCollateral.at(j)) {
                    found = true;
                }
            }
            if (!found) {
                return false;
            }
        }
        return true;
    }

    /// @return {attoUSD/fiatTok} The USD price at which a fiatcoin can be said to be defaulting
    function _defaultThreshold() private view returns (Fix) {
        ICollateral[] memory fiatcoins = _approvedFiatcoins();

        // Collect prices
        Fix[] memory prices = new Fix[](fiatcoins.length);
        for (uint256 i = 0; i < fiatcoins.length; i++) {
            int8 decimals = int8(fiatcoins[i].fiatcoinDecimals());

            // {attoUSD/fiatTok} = {attoUSD/qFiatTok} * {qFiatTok/fiatTok}
            prices[i] = fiatcoins[i].fiatcoinPriceUSD(address(this)).shiftLeft(decimals); // {attoUSD/fiatTok}
        }

        // Sort
        for (uint256 i = 0; i < prices.length - 1; i++) {
            uint256 min = i;
            for (uint256 j = i; j < prices.length; j++) {
                if (prices[j].lt(prices[min])) {
                    min = j;
                }
            }
            if (min != i) {
                Fix tmp = prices[i];
                prices[i] = prices[min];
                prices[min] = tmp;
            }
        }

        // Take the median
        Fix median;
        if (prices.length % 2 == 0) {
            median = prices[prices.length / 2 - 1].plus(prices[prices.length / 2]).divu(2);
        } else {
            median = prices[prices.length / 2];
        }

        // median - (median * defaultThreshold)
        return median.minus(median.mul(defaultThreshold));
    }

    /// @return fiatcoins The subset of `collateral` that is fiatcoin
    function _approvedFiatcoins() private view returns (ICollateral[] memory fiatcoins) {
        uint256 size;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            if (ICollateral(_approvedCollateral.at(i)).isFiatcoin()) {
                size++;
            }
        }
        fiatcoins = new ICollateral[](size);
        size = 0;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            if (ICollateral(_approvedCollateral.at(i)).isFiatcoin()) {
                fiatcoins[size] = ICollateral(_approvedCollateral.at(i));
                size++;
            }
        }
    }
}
