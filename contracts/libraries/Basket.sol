// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./Token.sol";

/**
 * @title Basket
 */
library Basket {
    using Token for Token.Info;

    struct Info {
        mapping(uint16 => Token.Info) tokens;
        uint16 size;
    }

    /// The returned array will be in the same order as the current self.
    function issueAmounts(Basket.Info storage self, uint256 amount, uint256 scale, uint256 spread, uint8 decimals) internal view returns (uint256[] memory parts) {
        parts = new uint256[](self.size);
        for (uint16 i = 0; i < self.size; i++) {
            parts[i] = (amount * self.tokens[i].adjustedQuantity) / 10**decimals;
            parts[i] = (parts[i] * (scale + spread)) / scale;
        }
    }

    /// The returned array will be in the same order as the current self.
    function redemptionAmounts(Basket.Info storage self, uint256 amount, uint8 decimals, uint256 totalSupply) internal view returns (uint256[] memory parts) {
        parts = new uint256[](self.size);
        bool isFullyCollateralized = leastCollateralized(self, decimals, totalSupply) == -1;

        for (uint16 i = 0; i < self.size; i++) {
            if (isFullyCollateralized) {
                parts[i] = (self.tokens[i].adjustedQuantity * amount) / 10**decimals;
            } else {
                parts[i] = (self.tokens[i].getBalance() * amount) / totalSupply;
            }
        }
    }

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized(Basket.Info storage self, uint8 decimals, uint256 totalSupply) internal view returns (int32) {
        uint256 largestDeficitNormed;
        int32 index = -1;

        for (uint16 i = 0; i < self.size; i++) {
            uint256 bal = self.tokens[i].getBalance();
            uint256 expected = (totalSupply * self.tokens[i].adjustedQuantity) / 10**decimals;

            if (bal < expected) {
                uint256 deficitNormed = (expected - bal) / self.tokens[i].adjustedQuantity;
                if (deficitNormed > largestDeficitNormed) {
                    largestDeficitNormed = deficitNormed;
                    index = int32(uint32(i));
                }
            }
        }
        return index;
    }

    /// Returns the index of the most collateralized token, or -1.
    function mostCollateralized(Basket.Info storage self, uint8 decimals, uint256 totalSupply) internal view returns (int32) {
        uint256 largestSurplusNormed;
        int32 index = -1;

        for (uint16 i = 0; i < self.size; i++) {
            uint256 bal = self.tokens[i].getBalance();
            uint256 expected = (totalSupply * self.tokens[i].adjustedQuantity) / 10**decimals;
            expected += self.tokens[i].rateLimit;

            if (bal > expected) {
                uint256 surplusNormed = (bal - expected) / self.tokens[i].adjustedQuantity;
                if (surplusNormed > largestSurplusNormed) {
                    largestSurplusNormed = surplusNormed;
                    index = int32(uint32(i));
                }
            }
        }
        return index;
    }
}
