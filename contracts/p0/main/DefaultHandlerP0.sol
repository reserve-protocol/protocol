// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
 *    selection of the next vault. */
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

    ICollateral[] private _depegged;
    mapping(ICollateral => uint256) private _timestampOfDepegging;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.init(args);
    }

    /// @dev This should handle parallel collateral defaults independently
    function poke() public virtual override notPaused {
        super.poke();

        ICollateral[] memory softDefaulting = _checkForSoftDefault();
        for (uint256 i = 0; i < softDefaulting.length; i++) {
            bool alreadyDepegged = _in(softDefaulting[i], _depegged);
            if (!alreadyDepegged) {
                _timestampOfDepegging[softDefaulting[i]] = block.timestamp;
            } else if (block.timestamp >= defaultDelay() + _timestampOfDepegging[_depegged[i]]) {
                _unapproveCollateral(_depegged[i]);
            }
        }
        _depegged = softDefaulting;

        if (softDefaulting.length == 0) {
            _setMood(fullyCapitalized() ? Mood.CALM : Mood.TRADING);
        } else if (!_vaultIsOnlyApprovedCollateral(vault)) {
            _switchVault(_selectNextVault());
            _setMood(Mood.TRADING);
        } else {
            _setMood(Mood.DOUBT);
        }
    }

    /// Checks for hard default by inspecting the redemption rates of all collateral tokens
    /// Forces updates in the underlying defi protocols
    /// @return defaulting All hard-defaulting tokens
    function _checkForHardDefault() internal returns (ICollateral[] memory defaulting) {
        ICollateral[] memory collateral = new ICollateral[](_approvedCollateral.length());
        uint256 count;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            bool ok = ICollateral(_approvedCollateral.at(i)).poke();
            if (!ok) {
                collateral[count] = ICollateral(_approvedCollateral.at(i));
                count++;
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

            Fix price = c.fiatcoinPriceUSD(oracle()).shiftLeft(int8(c.fiatcoinDecimals()));
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
    function _selectNextVault() internal view returns (IVault) {
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
            prices[i] = fiatcoins[i].fiatcoinPriceUSD(oracle()).shiftLeft(decimals); // {attoUSD/fiatTok}
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
        return median.minus(median.mul(defaultThreshold()));
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

    /// @return Whether `c` is in `arr`
    function _in(ICollateral c, ICollateral[] storage arr) private view returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (c == arr[i]) {
                return true;
            }
        }
        return false;
    }
}
