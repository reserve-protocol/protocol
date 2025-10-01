// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../p1/mixins/Component.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ComponentReentrantMock
 * @notice Minimal mock component for testing reentrancy protection
 * @dev Only used in unit tests to create proper globalNonReentrant context
 */
contract ComponentReentrantMock is ComponentP1 {

    function init(IMain main_) external initializer {
        __Component_init(main_);
    }

    /**
     * @notice Test function that creates globalNonReentrant context and transfers tokens
     * @dev This simulates a real component function that might trigger token transfers
     */
    function testReentrantTransfer(
        IERC20 token,
        address to,
        uint256 amount
    ) external globalNonReentrant {
        // This transfer will trigger reentrancy attacks if the token is malicious
        // The globalNonReentrant modifier ensures any reentrancy attempts are blocked
        token.transfer(to, amount);
    }

    /**
     * @notice Another test function to verify reentrancy protection across different functions
     */
    function testReentrantTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) external globalNonReentrant {
        token.transferFrom(from, to, amount);
    }

    /**
     * @notice Simple function without reentrancy protection (for comparison)
     */
    function testNormalTransfer(
        IERC20 token,
        address to,
        uint256 amount
    ) external {
        // This has no reentrancy protection, so attacks should succeed
        token.transfer(to, amount);
    }
}