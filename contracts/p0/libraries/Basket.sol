// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
}

/*
 * @title BasketLib
 * @dev
 *   - deposit(from, amtBUs): Deposit collateral equivalent to amtBUs
 *   - withdraw(to, amtBUs): Withdraw collateral equivalent to amtBUs
 */
library BasketLib {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    /// Transfer `amtBUs` worth of collateral into the caller's account
    /// @param from The address that is sending collateral
    /// @return amounts The token amounts transferred in
    function deposit(
        Basket storage self,
        address from,
        Fix amtBUs
    ) internal returns (uint256[] memory amounts) {
        amounts = new uint256[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            // {qTok} = {BU} * {qTok/BU}
            amounts[i] = amtBUs.mul(quantity(self, self.collateral[i])).ceil();
            self.collateral[i].erc20().safeTransferFrom(from, address(this), amounts[i]);
        }
    }

    /// Transfer `amtBUs` worth of collateral out of the caller's account
    /// @param to The address that is receiving the collateral
    /// @return amounts The token amounts transferred out
    function withdraw(
        Basket storage self,
        address to,
        Fix amtBUs
    ) internal returns (uint256[] memory amounts) {
        amounts = new uint256[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            // {qTok} = {BU} * {qTok/BU}
            amounts[i] = amtBUs.mul(quantity(self, self.collateral[i])).floor();
            self.collateral[i].erc20().safeTransfer(to, amounts[i]);
        }
    }

    // ==== View ====

    /// @return {qTok/BU} The quantity of collateral asset targeted per BU
    function quantity(Basket storage self, ICollateral collateral) internal view returns (Fix) {
        // {qTok/BU} = {attoRef/BU} / {attoRef/qTok}
        return self.amounts[collateral].div(collateral.referencePrice());
    }

    /// @return max {BU} The maximum number of basket units that `account` can create
    function maxIssuableBUs(Basket storage self, address account) internal view returns (Fix max) {
        max = FIX_MAX;
        for (uint256 i = 0; i < self.size; i++) {
            Fix bal = toFix(self.collateral[i].erc20().balanceOf(account)); // {qTok}
            Fix q = quantity(self, self.collateral[i]); // {qTok/BU}
            if (q.gt(FIX_ZERO)) {
                // {BU} = {qTok} / {qTok/BU}
                Fix amtBUs = bal.div(q);
                if (amtBUs.lt(max)) {
                    max = amtBUs;
                }
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
