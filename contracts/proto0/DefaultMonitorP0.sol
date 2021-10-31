// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/Context.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IDefaultMonitor.sol";
import "./interfaces/IMain.sol";
import "./MainP0.sol";

/**
 * @title DefaultMonitorP0
 * @dev The default monitor checks for default states in other systems.
 */
contract DefaultMonitorP0 is Context, IDefaultMonitor {
    uint256 public constant SCALE = 1e18;

    IMain public main;

    mapping(address => uint256) public redemptionRates;

    constructor(IMain main_) {
        main = main_;
    }

    function checkForHardDefault(IVault vault) external override returns (IAsset[] memory defaulting) {
        require(_msgSender() == address(main), "main only");
        IAsset[] memory vaultAssets = new IAsset[](vault.size());
        uint256 count;
        for (uint256 i = 0; i < vault.size(); i++) {
            IAsset a = vault.assetAt(i);
            uint256 redemptionRate = a.redemptionRate();
            if (redemptionRate + 1 < redemptionRates[address(a)]) {
                vaultAssets[count] = a;
                count++;
            }
            redemptionRates[address(a)] = redemptionRate;
        }
        defaulting = new IAsset[](count);
        for (uint256 i = 0; i < count; i++) {
            defaulting[i] = vaultAssets[i];
        }
    }

    function checkForSoftDefault(IVault vault, address[] memory fiatcoins)
        public
        view
        override
        returns (IAsset[] memory defaulting)
    {
        uint256 defaultThreshold = _defaultThreshold(fiatcoins);
        IAsset[] memory vaultAssets = new IAsset[](vault.size());
        uint256 count;
        for (uint256 i = 0; i < vaultAssets.length; i++) {
            IAsset a = vault.assetAt(i);
            if (a.fiatcoinPriceUSD(main) < defaultThreshold) {
                vaultAssets[count] = a;
                count++;
            }
        }
        defaulting = new IAsset[](count);
        for (uint256 i = 0; i < count; i++) {
            defaulting[i] = vaultAssets[i];
        }
    }

    // Returns the vault that should replace the current vault, or the zero address if no options are available.
    function getNextVault(
        IVault vault,
        address[] memory approvedCollateral,
        address[] memory fiatcoins
    ) external override returns (IVault) {
        uint256 maxRate;
        uint256 indexMax = 0;

        // Loop through backups to find the highest value one that doesn't contain defaulting collateral
        IVault[] memory backups = vault.getBackups();
        for (uint256 i = 0; i < backups.length; i++) {
            if (backups[i].containsOnly(approvedCollateral) && checkForSoftDefault(backups[i], fiatcoins).length == 0) {
                uint256 rate = backups[i].basketRate();

                // See if it has the highest basket rate
                if (rate > maxRate) {
                    maxRate = rate;
                    indexMax = i;
                }
            }
        }

        if (maxRate == 0) {
            return IVault(address(0));
        }
        return backups[indexMax];
    }

    // Computes the USD price (18 decimals) at which a fiatcoin should be considered to be defaulting.
    function _defaultThreshold(address[] memory fiatcoins) internal view returns (uint256) {
        // Collect prices
        uint256[] memory prices = new uint256[](fiatcoins.length);
        for (uint256 i = 0; i < fiatcoins.length; i++) {
            prices[i] = IAsset(fiatcoins[i]).fiatcoinPriceUSD(main);
        }

        // Sort
        for (uint256 i = 1; i < prices.length; i++) {
            uint256 key = prices[i];
            uint256 j = i - 1;
            while (j >= 0 && prices[j] > key) {
                prices[j + 1] = prices[j];
                j--;
            }
            prices[j + 1] = key;
        }

        // Take the median
        uint256 price;
        if (prices.length % 2 == 0) {
            price = (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
        } else {
            price = prices[prices.length / 2];
        }

        return (price * (SCALE - main.config().defaultThreshold)) / SCALE;
    }
}
