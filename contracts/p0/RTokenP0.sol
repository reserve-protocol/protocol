// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply.
 */
contract RTokenP0 is IRToken, ERC20 {
    IMainP0 public main;

    constructor(
        IMainP0 main_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        main = main_;
    }

    /// Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == address(main.manager()), "only asset manager");
        _mint(recipient, amount);
        return true;
    }

    /// Burns a quantity of RToken from an account, only callable by AssetManager or `from`
    /// @param from The account from which RToken should be burned
    /// @param amount {qTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == address(main.manager()) || _msgSender() == from, "only asset manager or self");
        _burn(from, amount);
        return true;
    }
}
