// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/// @param collateral Mapping from an incremental index to asset
/// @param amounts {attoRef/BU}
/// @param size The number of collateral in the basket
struct Basket {
    mapping(uint256 => ICollateral) collateral; // index -> asset
    mapping(ICollateral => Fix) amounts; // {attoRef/BU}
    uint256 size;
    uint256 configuredAtBlock; // {block number}
}

library BasketLib {
    /// Sets the basket using a data format that can actually be passed around in memory
    function set(
        Basket self,
        ICollateral[] calldata collateral,
        Fix[] calldata amounts
    ) internal {
        require(collateral.length == amounts.length, "must be same lengths");
        for (uint256 i = 0; i < self.size; i++) {
            self.collateral[i] = collateral[i];
            self.amounts[i] = amounts[i];
        }
        self.size = collateral.length;
        self.configuredAtBlock = block.number;
    }

    /// @return {qTok/BU} The quantity of collateral asset targeted per BU
    function perBU(Basket self, ICollateral collateral) internal view returns (Fix) {
        // {qTok/BU} = {attoRef/BU} / {attoRef/qTok}
        return self.amounts[collateral].div(collateral.referencePrice());
    }

    /// @param amtBUs {BU}
    /// @return amounts {qTok} A list of token quantities that are worth approximately `amtBUs`
    function toCollateralAmounts(
        Basket self,
        Fix amtBUs,
        RoundingApproach rounding
    ) internal view returns (uint256[] memory amounts) {
        amounts = new uint256[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            // {qTok} = {BU} * {qTok/BU}
            amounts[i] = amtBUs.mul(perBU(self, self.collateral[i])).toUint(rounding);
        }
    }

    /// @return max {qBU} The maximum number of basket units that `account` can create
    function maxBUs(Basket self, address account) internal view returns (Fix max) {
        max = FIX_MAX;
        for (uint256 i = 0; i < self.size; i++) {
            // {qTok}
            Fix bal = toFix(self.collateral[i].erc20().balanceOf(account));
            // {BU} = {qTok} / {qTok/BU}
            Fix amtBUs = bal.div(perBU(self, self.collateral[i]));
            if (amtBUs.lt(max)) {
                max = amtBUs;
            }
        }
    }

    /// @return erc20s The addresses of the ERC20 tokens of the backing collateral tokens
    function backingERC20s(Basket self) internal view returns (address[] memory erc20s) {
        erc20s = new address[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            erc20s[i] = address(self.collateral[i].erc20());
        }
    }
}
