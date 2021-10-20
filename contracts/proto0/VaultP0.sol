// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./collateral/Collateral.sol";
import "./interfaces/IVault.sol";

contract VaultP0 is IVault, Ownable {
    using SafeERC20 for IERC20;

    uint8 public constant decimals = 18;

    Basket internal _basket;

    mapping(address => uint256) public override basketUnits;
    uint256 public totalUnits;

    IVault[] public backups;

    constructor(Collateral[] memory collateral, IVault[] memory backupVaults) {
        // Set default immutable basket
        _basket.size = collateral.length;
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.collateral[i] = collateral[i];
        }

        backups = backupVaults;
    }

    // Returns the collateral token quantities required to issue/redeem a Basket Unit
    function tokenAmounts(uint256 amount) public view override returns (uint256[] memory parts) {
        parts = new uint256[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            parts[i] = (amount * _basket.collateral[i].quantity()) / 10**decimals;
        }
    }

    //

    function issue(uint256 amount) external override {
        require(amount > 0, "Cannot issue zero");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = tokenAmounts(amount);

        for (uint256 i = 0; i < _basket.size; i++) {
            IERC20(_basket.collateral[i].erc20()).safeTransferFrom(_msgSender(), address(this), amounts[i]);
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
            IERC20(_basket.collateral[i].erc20()).safeTransfer(redeemer, amounts[i]);
        }
    }

    // Returns how many fiatcoins a single BU can be redeemed for.
    // Can't be a view because the cToken and aToken could cause state changes to their Defi protocols.
    function basketFiatcoinRate() external override returns (uint256 sum) {
        ICollateral c;
        for (uint256 i = 0; i < _basket.size; i++) {
            c = ICollateral(_basket.collateral[i]);
            sum += (c.quantity() * c.getRedemptionRate()) / c.decimals();
        }
    }

    //

    function maxIssuable(address issuer) external view override returns (uint256) {
        uint256 min = type(uint256).max;
        for (uint256 i = 0; i < _basket.size; i++) {
            ICollateral c = _basket.collateral[i];
            uint256 cur = (IERC20(c.erc20()).balanceOf(issuer) * 10**c.decimals()) / c.quantity();
            if (cur < min) {
                min = cur;
            }
        }
        return min;
    }

    function basketSize() external view override returns (uint256) {
        return _basket.size;
    }

    function collateralAt(uint256 index) external view override returns (ICollateral) {
        return _basket.collateral[index];
    }

    // Returns the basket quantity for the collateral with erc20 equal to *token*.
    // Note that *token* here is the underlying erc20, not one of our Collateral instances.
    function basketQuantity(address token) external view override returns (uint256) {
        for (uint256 i = 0; i < _basket.size; i++) {
            if (_basket.collateral[i].erc20() == token) {
                return _basket.collateral[i].quantity();
            }
        }
        return 0;
    }

    function setBackups(IVault[] memory backupVaults) external onlyOwner {
        backups = backupVaults;
    }

    function getBackups() external view returns (IVault[] memory) {
        return backups;
    }

    // // Returns the quantities of tokens missing from *other's* basket.
    // function basketDelta(IVault other) external view override returns (uint256[] memory missing) {
    //     missing = new uint256[](_basket.size);
    //     for (uint i = 0; i < _basket.size; i++) {
    //         uint256 q = _basket.collateral[i].quantity();
    //         uint256 otherQ = other.basketQuantity(_basket.collateral[i].erc20());
    //         if (q > otherQ) {
    //             missing[i] = q - otherQ;
    //         }
    //     }
    // }
}
