// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * @title Token
 * @dev A Token contains the quantity and trading information for a given ERC20 token. 
 */
library Token {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Info {
        // Token address
        address tokenAddress;
        // How many tokens are required for each 1e18 RTokens as of original deployment
        uint256 genesisQuantity;
        // How many tokens to sell per each block
        uint256 rateLimit;
        // Max number of tokens to sell in a single trade
        uint256 maxTrade;
        // Quantity of Token that is equal in value to 1e18 RTokens (always a little stale)
        uint256 priceInRToken;
        // A number <=1e18 that indicates how much price movement to allow.
        // E.g., 5e17 means up to a 50% price movement before the RToken halts trading.
        // The slippage for a pair is the combination of two `slippageTolerance`
        uint256 slippageTolerance;
    }

    /// Safely approves *spender* to spend *amount* of the token.  
    function safeApprove(
        Token.Info storage self,
        address spender,
        uint256 amount
    ) internal {
        return IERC20Upgradeable(self.tokenAddress).safeApprove(spender, amount);
    }

    /// Safely transfers *amount* of the token to *to*.  
    function safeTransfer(
        Token.Info storage self,
        address to,
        uint256 amount
    ) internal {
        return IERC20Upgradeable(self.tokenAddress).safeTransfer(to, amount);
    }

    /// Safely transfers *amount* of the token from *from* to *to*.  
    function safeTransferFrom(
        Token.Info storage self,
        address from,
        address to,
        uint256 amount
    ) internal {
        return IERC20Upgradeable(self.tokenAddress).safeTransferFrom(from, to, amount);
    }

    /// Returns the balance the current caller has of the token. 
    function myBalance(Token.Info storage self) internal view returns (uint256) {
        return IERC20Upgradeable(self.tokenAddress).balanceOf(address(this));
    }

    /// Returns the balance an account has of the token. 
    function getBalance(Token.Info storage self, address account) internal view returns (uint256) {
        return IERC20Upgradeable(self.tokenAddress).balanceOf(account);
    }
}
