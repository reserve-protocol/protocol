// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVault.sol";

struct Token {
    address tokenAddress;
    uint256 quantity; // Quantity required for each basket unit
}

struct Basket {
    mapping(uint16 => Token) tokens;
    uint16 size;
}

contract VaultP0 is IVault, Ownable {
    using SafeERC20 for IERC20;

    uint256 public SCALE = 1e18;
    //uint8 public decimals = 18;

    Basket internal _basket;

    mapping(address => uint256) public basketUnits;
    uint256 public totalUnits;

    //TODO: IVault[] public backupVaults;

    constructor(Token[] memory basketTokens_) {
        // Set default immutable basket
        _basket.size = uint16(basketTokens_.length);
        for (uint16 i = 0; i < _basket.size; i++) {
            _basket.tokens[i] = basketTokens_[i];
        }
    }

    function issue(uint256 amount) external override {
        require(amount > 0, "Cannot issue zero");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory tokenAmounts = _issueAmounts(amount);

        for (uint16 i = 0; i < _basket.size; i++) {
            IERC20(_basket.tokens[i].tokenAddress).safeTransferFrom(_msgSender(), address(this), tokenAmounts[i]);
        }

        basketUnits[_msgSender()] += amount;
        totalUnits += amount;
    }

    // Returns the collateral token quantities required to issue a Basket Unit
    function _issueAmounts(uint256 amount) internal view returns (uint256[] memory parts) {
        parts = new uint256[](_basket.size);
        for (uint16 i = 0; i < _basket.size; i++) {
            parts[i] = (amount * _basket.tokens[i].quantity) / SCALE; // Or 10**decimals?
        }
    }

    function basketSize() external view returns (uint16) {
        return _basket.size;
    }

    function tokenInfoAt(uint16 index) external view returns (Token memory) {
        Token memory _tkn = _basket.tokens[index];
        return _tkn;
    }
}
