// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

struct Basket {
    mapping(uint16 => Token) tokens;
    uint16 size;
}

/**
 * @title Token
 */
library Token {
    using SafeERC20 for IERC20;

    struct Info {
        address tokenAddress;

        // How many tokens are required for each 1e18 RTokens as of original deployment
        uint256 genesisQuantity;

        // How many tokens are required in the current block for each 1e18 RTokens
        uint256 adjustedQuantity;

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

    function adjustQuantity(Token.Info storage self, uint256 scale, uint256 supplyExpansionRate, uint256 timestampDeployed) internal {
        self.adjustedQuantity = self.genesisQuantity * scale / (scale + supplyExpansionRate * (block.timestamp - timestampDeployed) / 31536000);
    }

    function safeApprove(Token.Info storage self, address spender, uint256 amount) internal {
        return IERC20(self.tokenAddress).safeApprove(spender, amount);
    }

    function safeTransfer(Token.Info storage self, address to, uint256 amount) internal {
        return IERC20(self.tokenAddress).safeTransfer(to, amount);
    }

    function safeTransferFrom(Token.Info storage self, address from, address to, uint256 amount) internal {
        return IERC20(self.tokenAddress).safeTransferFrom(from, to, amount);
    }

    function getBalance(Token.Info storage self) internal view returns(uint256) {
        return IERC20(self.tokenAddress).balanceOf(address(this));
    }

}
