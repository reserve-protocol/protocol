// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/Moody.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/VaultHandler.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistry.sol";
import "./Moody.sol";
import "./SettingsHandler.sol";
import "./VaultHandler.sol";

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

    EnumerableSet.AddressSet private _defaulting;
    mapping(ICollateral => uint256) private _defaultingTimestamp;

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
        _checkForHardDefault();
        _checkForSoftDefault();
        _tryEnsureValidVault();
    }

    function beforeUpdate()
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.beforeUpdate();
    }

    /// Checks for hard default.
    /// Effectively, asks each Collateral if the exogenous capital still satisfies its invariants,
    /// and "unapproves" in Main each token that does not.
    function _checkForHardDefault() internal {
        uint256 count;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            ICollateral c = ICollateral(_approvedCollateral.at(i));
            bool ok = c.poke();
            if (!ok) {
                _unapproveCollateral(c);
                count++;
            }
        }
    }

    /// Checks for soft default.
    /// A token triggers "soft" (delayed) default when its redemption
    /// by checking oracle values for all fiatcoins in the vault
    function _checkForSoftDefault() internal {
        // Compute the list of defaulting collateral
        Fix defaultThreshold = _defaultThreshold();
        address[] memory defaulting = new address[](_approvedCollateral.length());
        uint256 count;
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            ICollateral c = ICollateral(_approvedCollateral.at(i));

            Fix price = c.fiatcoinPriceUSD(oracle()).shiftLeft(int8(c.fiatcoinDecimals()));
            if (price.lte(defaultThreshold)) {
                defaulting[count] = address(c);
                count++;
            }
        }

        // defaulting is now an array of all collateral tokens redeemable for a defaulting fiatcoin

        // Remove from _defaulting any collateral that has recovered
        address[] memory prev = _defaulting.values();
        for (uint256 i = 0; i < prev.length; i++) {
            bool found;
            for (uint256 j = 0; j < count; j++) {
                if (address(defaulting[j]) == prev[i]) {
                    found = true;
                }
            }
            if (!found) {
                _defaulting.remove(prev[i]);
            }
        }

        // Unapprove any collateral that has been defaulting for > `defaultDelay`
        for (uint256 i = 0; i < count; i++) {
            if (!_defaulting.contains(defaulting[i])) {
                _defaulting.add(defaulting[i]);
                _defaultingTimestamp[ICollateral(defaulting[i])] = block.timestamp;
            } else if (
                block.timestamp >= defaultDelay() + _defaultingTimestamp[ICollateral(defaulting[i])]
            ) {
                _unapproveCollateral(ICollateral(defaulting[i]));
                _defaulting.remove(defaulting[i]);
            }
        }
    }

    /// Ensure the vault only consists of approved collateral by changing it, or entering DOUBT
    /// A viable vault has no defaulting nor defaulted tokens.
    function _tryEnsureValidVault() internal {
        if (_isValid(vault())) {
            _setMood(fullyCapitalized() ? Mood.CALM : Mood.TRADING);
            return;
        }

        if (!_vaultIsDefaulting(vault())) {
            (bool hasNext, IVault nextVault) = _selectNextVault();
            if (hasNext) {
                _switchVault(nextVault);
                _setMood(Mood.TRADING);
                return;
            }
        }
        _setMood(Mood.DOUBT);
    }

    /// @return A vault from the list of backup vaults that is not defaulting
    function _selectNextVault() private view returns (bool, IVault) {
        Fix maxRate;
        uint256 indexMax = 0;
        IVault[] memory backups = vault().getBackups();

        // Loop through backups to find the highest value one that doesn't contain defaulting collateral
        for (uint256 i = 0; i < backups.length; i++) {
            if (_isValid(backups[i])) {
                Fix rate = backups[i].basketRate(); // {USD}

                // See if it has the highest basket rate
                if (rate.gt(maxRate)) {
                    maxRate = rate;
                    indexMax = i;
                }
            }
        }

        if (maxRate.eq(FIX_ZERO)) {
            return (false, IVault(address(0)));
        }
        return (true, backups[indexMax]);
    }

    /// @return Whether a vault contains collateral that is currently defaulting
    function _vaultIsDefaulting(IVault vault_) private view returns (bool) {
        for (uint256 i = 0; i < vault_.size(); i++) {
            for (uint256 j = 0; j < _defaulting.length(); j++) {
                if (_defaulting.at(j) == address(vault_.collateralAt(i))) {
                    return true;
                }
            }
        }
        return false;
    }

    /// A valid vault is a vault that contains only approved collateral and no defaulting collateral.
    function _isValid(IVault vault_) private view returns (bool) {
        for (uint256 i = 0; i < vault_.size(); i++) {
            if (!_approvedCollateral.contains(address(vault_.collateralAt(i)))) {
                return false;
            }
            for (uint256 j = 0; j < _defaulting.length(); j++) {
                if (_defaulting.at(j) == address(vault_.collateralAt(i))) {
                    return false;
                }
            }
        }
        return true;
    }

    /// @return {attoUSD/fiatTok} The USD price at which a fiatcoin can be said to be defaulting
    function _defaultThreshold() private view returns (Fix) {
        uint256 numFiatcoins;
        ICollateral[] memory fiatcoins = new ICollateral[](_approvedCollateral.length());
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            if (ICollateral(_approvedCollateral.at(i)).isFiatcoin()) {
                fiatcoins[numFiatcoins] = ICollateral(_approvedCollateral.at(i));
                numFiatcoins++;
            }
        }

        // Collect prices
        Fix[] memory prices = new Fix[](numFiatcoins);
        for (uint256 i = 0; i < numFiatcoins; i++) {
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
}
