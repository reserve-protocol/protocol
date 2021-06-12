pragma solidity 0.5.7;

import "../zeppelin/token/ERC20/ERC20.sol";

/**
 * Simple ERC20 for testing. 
 */
contract BasicERC20 is ERC20 {
    constructor() public {
        _mint(msg.sender, 1e48);
    }
}
