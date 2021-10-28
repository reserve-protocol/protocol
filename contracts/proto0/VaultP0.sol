// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./assets/AAVEAssetP0.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IVault.sol";

/*
 * @title VaultP0
 * @dev The Manager backs an RToken by some number of Vaults, each with an immutable basket definition.
 *  A Vault issues Basket Units (BUs) to the Manager for internal bookkeeping and provides helpers.
 */
contract VaultP0 is IVault, Ownable {
    using SafeERC20 for IERC20;

    uint8 public constant BUDecimals = 18;

    Basket internal _basket;

    mapping(address => uint256) public override basketUnits;
    uint256 public totalUnits;

    IVault[] public backups;

    constructor(
        IAsset[] memory assets,
        uint256[] memory quantities,
        IVault[] memory backupVaults
    ) {
        require(assets.length == quantities.length, "arrays must match in length");

        // Set default immutable basket
        _basket.size = assets.length;
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.assets[i] = assets[i];
            _basket.quantities[i] = quantities[i];
        }

        backups = backupVaults;
    }

    // Returns the assets token quantities required to issue/redeem a Basket Unit
    function tokenAmounts(uint256 amount) public view override returns (uint256[] memory parts) {
        parts = new uint256[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            parts[i] = (amount * _basket.quantities[i]) / 10**BUDecimals;
        }
    }

    //

    function issue(uint256 amount) external override {
        require(amount > 0, "Cannot issue zero");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = tokenAmounts(amount);

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.assets[i].erc20().safeTransferFrom(_msgSender(), address(this), amounts[i]);
        }

        basketUnits[_msgSender()] += amount;
        totalUnits += amount;
    }

    function redeem(address redeemer, uint256 amount) external override {
        require(amount > 0, "Cannot redeem zero");
        require(amount <= basketUnits[_msgSender()], "Not enough units");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = tokenAmounts(amount);

        basketUnits[_msgSender()] -= amount;
        totalUnits -= amount;

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.assets[i].erc20().safeTransfer(redeemer, amounts[i]);
        }
    }

    // Claims COMP/AAVE and sweeps any balance to the Asset Manager.
    function claimAndSweepRewardsToManager(IMain main) external override {
        // Claim
        main.comptroller().claimComp(address(this));
        IStaticAToken(address(main.aaveAsset().erc20())).claimRewardsToSelf(true);

        // Sweep
        IERC20 comp = main.compAsset().erc20();
        IERC20 aave = main.aaveAsset().erc20();
        if (comp.balanceOf(address(this)) > 0) {
            comp.safeTransfer(address(main.manager()), comp.balanceOf(address(this)));
        }
        if (aave.balanceOf(address(this)) > 0) {
            aave.safeTransfer(address(main.manager()), aave.balanceOf(address(this)));
        }
    }

    // Returns how many fiatcoins a single BU can be redeemed for.
    function basketFiatcoinRate() external view override returns (uint256 sum) {
        for (uint256 i = 0; i < _basket.size; i++) {
            IAsset c = _basket.assets[i];
            sum += (_basket.quantities[i] * c.redemptionRate()) / 10**c.decimals();
        }
    }

    //

    // Returns whether the vault consists of only tokens from the *assets* set.
    function containsOnly(address[] memory assets) external view override returns (bool) {
        for (uint256 i = 0; i < _basket.size; i++) {
            bool found = false;
            for (uint256 j = 0; j < assets.length; j++) {
                if (address(_basket.assets[i]) == assets[j]) {
                    found = true;
                }
            }
            if (!found) {
                return false;
            }
        }
        return true;
    }

    function maxIssuable(address issuer) external view override returns (uint256) {
        uint256 min = type(uint256).max;
        for (uint256 i = 0; i < _basket.size; i++) {
            uint256 BUs = _basket.assets[i].erc20().balanceOf(issuer) / _basket.quantities[i];
            if (BUs < min) {
                min = BUs;
            }
        }
        return min;
    }

    function size() external view override returns (uint256) {
        return _basket.size;
    }

    function assetAt(uint256 index) external view override returns (IAsset) {
        return _basket.assets[index];
    }

    // Returns the basket quantity for the given assets.
    function quantity(IAsset asset) external view override returns (uint256) {
        for (uint256 i = 0; i < _basket.size; i++) {
            if (_basket.assets[i] == asset) {
                return _basket.quantities[i];
            }
        }
        return 0;
    }

    function getBackups() external view override returns (IVault[] memory) {
        return backups;
    }

    function setBackups(IVault[] memory backupVaults) external onlyOwner {
        backups = backupVaults;
    }
}
