// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

<<<<<<< HEAD
import "@openzeppelin/contracts/utils/math/Math.sol";
=======
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

>>>>>>> b99454c (Everywhere compute "adjustedQuantity" basket weights from genesisQuantity and basket.inflation)
import "./Token.sol";

/**
 * @title Basket
 */
library Basket {
    using Token for Token.Info;

    struct Info {
        mapping(uint16 => Token.Info) tokens;
        uint16 size;
        // inflationSinceGenesis: a SCALE decimal value. The inflation factor since basket genesis.
        // One RToken is worth inflation_since_genesis / SCALE * token[i].genesisQuantity
        uint256 inflationSinceGenesis;
    }

    function setTokens(Basket.Info storage self, Token.Info[] memory tokens) internal {
        self.size = uint16(tokens.length);
        for (uint16 i = 0; i < self.size; i++) {
            self.tokens[i] = tokens[i];
        }
    }

    /// Returns the basket-weight of token[index]
    function weight(
        Basket.Info storage self,
        uint256 scale,
        uint16 index
    ) internal view returns (uint256) {
        require(index < self.size, "High index");
        return (self.tokens[index].genesisQuantity * self.inflationSinceGenesis) / scale;
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
            parts[i] = (amount * weight(self, scale, i)) / 10**decimals;
            parts[i] = (parts[i] * (scale + spread)) / scale;
        }
    }

    /// The returned array will be in the same order as the current self.
    function redemptionAmounts(
        Basket.Info storage self,
        uint256 amount,
        uint256 scale,
        uint8 decimals,
        uint256 totalSupply
    ) internal view returns (uint256[] memory parts) {
        parts = new uint256[](self.size);
        for (uint16 i = 0; i < self.size; i++) {
            parts[i] = MathUpgradeable.min(
                (self.tokens[i].getBalance() * amount) / totalSupply,
                (weight(self, scale, i) * amount) / 10**decimals
            );
        }
    }

    /// Returns indices of tokens, or -1 no tokens fit the criteria.
    function leastUndercollateralizedAndMostOverCollateralized(
        Basket.Info storage self,
        uint256 scale, // TODO: prop
        uint8 decimals,
        uint256 totalSupply
    ) internal view returns (int32, int32) {
        uint256 largestDeficit;
        uint256 largestSurplus;
        int32 deficitIndex = -1;
        int32 surplusIndex = -1;

        for (uint16 i = 0; i < self.size; i++) {
            uint256 bal = self.tokens[i].getBalance();
            uint256 expected = (totalSupply * weight(self, scale, i)) / 10**decimals;

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
