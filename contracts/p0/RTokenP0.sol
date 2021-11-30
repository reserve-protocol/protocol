// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply.
 */
contract RTokenP0 is Ownable, ERC20, IRToken {
    address public override main;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == main, "only main");
        _mint(recipient, amount);
        return true;
    }

    /// Burns a quantity of RToken from an account, only callable by AssetManager or `from`
    /// @param from The account from which RToken should be burned
    /// @param amount {qTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == main || _msgSender() == from, "only main or self");
        _burn(from, amount);
        return true;
    }

    function setMain(address main_) external virtual override onlyOwner {
        main = main_;
    }
}
