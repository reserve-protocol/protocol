// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../RelayERC20.sol";

contract RelayERC20Mock is RelayERC20 {
    function initialize(string memory name, string memory symbol) external {
        __ERC20_init(name, symbol);
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function burn(address sender, uint256 amount) external {
        _burn(sender, amount);
    }
}
