// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IRToken.sol";

/**
 * @title RTokenP0
 * @dev A mintable/burnable ERC20 to be leveraged by the Manager to support a decentralized stablecoin.
 */
contract RTokenP0 is IRToken, ERC20 {
    IMain public main;

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        main = main_;
    }

    // Only the Manager can mint.
    function mint(address recipient, uint256 amount) external override returns (bool) {
        require(_msgSender() == address(main.manager()), "only asset manager");
        _mint(recipient, amount);
        return true;
    }

    // The Manager can burn from any account. Anyone can burn from their own account.
    function burn(address from, uint256 amount) external override returns (bool) {
        require(_msgSender() == address(main.manager()) || _msgSender() == from, "only asset manager or self");
        _burn(from, amount);
        return true;
    }
}
