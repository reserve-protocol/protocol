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

    function setTokens(Basket.Info storage self, Token.Info[] memory tokens) internal {
        self.size = uint16(tokens.length);
        for (uint16 i = 0; i < self.size; i++) {
            self.tokens[i] = tokens[i];
            self.tokens[i].adjustedQuantity = self.tokens[i].genesisQuantity;
        }
    }

    /// The returned array will be in the same order as the current self.
    function issueAmounts(
        Basket.Info storage self,
        uint256 amount,
        uint256 scale,
        uint256 spread,
        uint8 decimals
    ) internal view returns (uint256[] memory parts) {
        parts = new uint256[](self.size);
        for (uint16 i = 0; i < self.size; i++) {
            parts[i] = (amount * self.tokens[i].adjustedQuantity) / 10**decimals;
            parts[i] = (parts[i] * (scale + spread)) / scale;
        }
    }

    /// The returned array will be in the same order as the current self.
    function redemptionAmounts(
        Basket.Info storage self,
        uint256 amount,
        uint8 decimals,
        uint256 totalSupply
    ) internal view returns (uint256[] memory parts) {
        parts = new uint256[](self.size);
        (int32 deficitIndex, ) = leastUndercollateralizedAndMostOverCollateralized(
            self,
            decimals,
            totalSupply
        );

        for (uint16 i = 0; i < self.size; i++) {
            if (deficitIndex == -1) {
                parts[i] = (self.tokens[i].adjustedQuantity * amount) / 10**decimals;
            } else {
                parts[i] = (self.tokens[i].getBalance() * amount) / totalSupply;
            }
        }
    }

    /// Returns indices of tokens, or -1 no tokens fit the criteria.
    function leastUndercollateralizedAndMostOverCollateralized(
        Basket.Info storage self,
        uint8 decimals,
        uint256 totalSupply
    ) internal view returns (int32, int32) {
        uint256 largestDeficit;
        uint256 largestSurplus;
        int32 deficitIndex = -1;
        int32 surplusIndex = -1;

        for (uint16 i = 0; i < self.size; i++) {
            uint256 bal = self.tokens[i].getBalance();
            uint256 expected = (totalSupply * self.tokens[i].adjustedQuantity) / 10**decimals;

            if (bal < expected) {
                if (bal / expected > largestDeficit) {
                    largestDeficit = bal / expected;
                    deficitIndex = int32(uint32(i));
                }
            } else if (bal > expected + self.tokens[i].rateLimit) {
                if (bal / expected > largestSurplus) {
                    largestSurplus = bal / expected;
                    surplusIndex = int32(uint32(i));
                }
            }
        }
        return (deficitIndex, surplusIndex);
    }
}
