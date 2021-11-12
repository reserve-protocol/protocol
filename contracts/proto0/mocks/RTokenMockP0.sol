// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract RTokenMockP0 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    /// Mints a quantity of RToken to the `recipient`
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external returns (bool) {
        _mint(recipient, amount);
        return true;
    }

    /// Burns a quantity of RToken from an account
    /// @param from The account from which RToken should be burned
    /// @param amount {qTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external returns (bool) {
        _burn(from, amount);
        return true;
    }
}
