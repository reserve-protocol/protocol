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
    uint256 lastBlock; // {block number} last set
}

library BasketLib {
    using FixLib for Fix;

    /// Sets the basket using a data format that can actually be passed around in memory
    function set(
        Basket storage self,
        ICollateral[] memory collateral,
        Fix[] memory amounts
    ) internal {
        require(collateral.length == amounts.length, "must be same lengths");
        for (uint256 i = 0; i < self.size; i++) {
            self.collateral[i] = collateral[i];
            self.amounts[collateral[i]] = amounts[i];
        }
        self.size = collateral.length;
        self.lastBlock = block.number;
    }

    /// @return {qTok/BU} The quantity of collateral asset targeted per BU
    function quantity(Basket storage self, ICollateral collateral) internal view returns (Fix) {
        // {qTok/BU} = {attoRef/BU} / {attoRef/qTok}
        return self.amounts[collateral].div(collateral.referencePrice());
    }

    /// @param amtBUs {BU}
    /// @return amounts {qTok} A list of token quantities that are worth approximately `amtBUs`
    function toCollateralAmounts(
        Basket storage self,
        Fix amtBUs,
        RoundingApproach rounding
    ) internal view returns (uint256[] memory amounts) {
        amounts = new uint256[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            // {qTok} = {BU} * {qTok/BU}
            amounts[i] = amtBUs.mul(quantity(self, self.collateral[i])).toUint(rounding);
        }
    }

    /// @return max {BU} The maximum number of basket units that `account` can create
    function maxBUs(Basket storage self, address account) internal view returns (Fix max) {
        max = FIX_MAX;
        for (uint256 i = 0; i < self.size; i++) {
            // {qTok}
            Fix bal = toFix(self.collateral[i].erc20().balanceOf(account));
            // {BU} = {qTok} / {qTok/BU}
            Fix amtBUs = bal.div(quantity(self, self.collateral[i]));
            if (amtBUs.lt(max)) {
                max = amtBUs;
            }
        }
    }

    /// @return erc20s The addresses of the ERC20 tokens of the backing collateral tokens
    function backingERC20s(Basket storage self) internal view returns (address[] memory erc20s) {
        erc20s = new address[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            erc20s[i] = address(self.collateral[i].erc20());
        }
    }

    /// @return attoUSD {attoUSD/BU} The price of a whole BU in attoUSD
    function price(Basket storage self) internal view returns (Fix attoUSD) {
        for (uint256 i = 0; i < self.size; i++) {
            ICollateral a = self.collateral[i];

            // {attoUSD/BU} = {attoUSD/BU} + {attoUSD/qTok} * {qTok/BU}
            attoUSD = attoUSD.plus(a.price().mul(quantity(self, a)));
        }
    }
}
