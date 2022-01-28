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
    IMain public main;

    // solhint-disable no-empty-blocks
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == address(main), "only main");
        _mint(recipient, amount);
        return true;
    }

    /// Burns a quantity of RToken from an account, only callable by AssetManager or `from`
    /// @param from The account from which RToken should be burned
    /// @param amount {qTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == from || _msgSender() == address(main), "only self or main");
        _burn(from, amount);
        return true;
    }

    /// Withdraws a quantity of RToken from the RToken itself
    /// @param to The address to send the tokens to
    /// @param amount {qRTok} The amount to be withdrawn
    function withdraw(address to, uint256 amount) external virtual override {
        require(_msgSender() == address(main), "only main");
        _transfer(address(this), to, amount);
    }

    function setMain(IMain main_) external virtual override onlyOwner {
        main = main_;
    }
}
