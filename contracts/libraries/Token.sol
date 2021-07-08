// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title Token
 */
library Token {

    struct Info {
        address tokenAddress;

        // How many tokens are required for each 1e18 RTokens as of original deployment
        uint256 genesisQuantity;

        // How many tokens are required in the current block for each 1e18 RTokens
        uint256 adjustedQuantity;

        // How many tokens to sell per each block
        uint256 rateLimit;

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

    function getBalance(Token.Info storage self) internal {
        return IERC20Upgradeable(self.tokenAddress).balanceOf(address(this));
    }
}
