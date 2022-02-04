// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/// @param collateral Mapping from an incremental index to asset
/// @param refAmts {ref/BU}
/// @param size The number of collateral in the basket
struct Basket {
    mapping(uint256 => ICollateral) collateral; // index -> asset
    mapping(ICollateral => Fix) refAmts; // {ref/BU}
    uint256 size;
}

/*
 * @title BasketLib
 * @dev
 *   - empty()
 *   - copy(other: BasketLib)
 *   - add(coll: ICollateral, weight: Fix): Add weight to coll
 *   - transfer(to: address, quantities: Fix[]): like ERC20 transfer
 *   - transferFrom(from: address, to: address, quantities: Fix[]): like ERC20 transferFrom
 */
library BasketLib {
    using BasketLib for Basket;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    // Empty self
    function empty(Basket storage self) internal {
        for (uint256 i = 0; i < self.size; i++) {
            self.refAmts[self.collateral[i]] = FIX_ZERO;
            delete self.collateral[i];
        }
        self.size = 0;
    }

    /// Set `self` equal to `other`
    function copy(Basket storage self, Basket storage other) internal {
        empty(self);
        for (uint256 i = 0; i < other.size; i++) {
            ICollateral coll = other.collateral[i];
            self.collateral[i] = coll;
            self.refAmts[coll] = other.refAmts[coll];
        }
        self.size = other.size;
    }

    /// Add `weight` to the refAmount of collateral `coll` in the basket `self`
    function add(
        Basket storage self,
        ICollateral coll,
        Fix weight
    ) internal {
        if (self.refAmts[coll].eq(FIX_ZERO)) {
            self.collateral[self.size] = coll;
            self.refAmts[coll] = weight;
            self.size++;
        } else {
            self.refAmts[coll] = self.refAmts[coll].plus(weight);
        }
    }

    /// Transfer collateral tokens described by `quantities` from `from` to `to`
    /// @param to Recipient of collateral
    /// @param quantities {qTok} Collateral token quantities in the order of the basket
    function transfer(
        Basket storage self,
        address to,
        uint256[] memory quantities
    ) internal {
        assert(quantities.length == self.size);
        for (uint256 i = 0; i < quantities.length; i++) {
            self.collateral[i].erc20().safeTransfer(to, quantities[i]);
        }
    }

    /// Transfer collateral tokens described by `quantities` from `from` to `to`
    /// @param from Sender of collateral
    /// @param to Recipient of collateral
    /// @param quantities {qTok} Collateral token quantities in the order of the basket
    function transferFrom(
        Basket storage self,
        address from,
        address to,
        uint256[] memory quantities
    ) internal {
        assert(quantities.length == self.size);
        for (uint256 i = 0; i < quantities.length; i++) {
            self.collateral[i].erc20().safeTransferFrom(from, to, quantities[i]);
        }
    }

    // ==== View ====

    /// @return {qTok/BU} Quantity of quanta collateral per BU
    function quantity(Basket storage self, ICollateral c) internal view returns (Fix) {
        // {qTok/BU} = {ref/BU} / {ref/tok} * {qTok/tok}
        return self.refAmts[c].div(c.refPerTok()).shiftLeft(int8(c.erc20().decimals()));
    }

    /// @param amount {BU}
    /// @return collateral The backing collateral
    /// @return quantities {qTok} Collateral token quantities equal to `amount` BUs
    function quote(
        Basket storage self,
        Fix amount,
        RoundingApproach rounding
    ) internal view returns (ICollateral[] memory collateral, uint256[] memory quantities) {
        collateral = new ICollateral[](self.size);
        quantities = new uint256[](self.size);
        for (uint256 i = 0; i < self.size; i++) {
            collateral[i] = self.collateral[i];

            // {qTok} = {BU} * {qTok/BU}
            quantities[i] = amount.mul(self.quantity(self.collateral[i])).toUint(rounding);
        }
    }

    /// @return bal {BU} The balance of basket units held by `account`
    function balanceOf(Basket storage self, address account) internal view returns (Fix bal) {
        bal = FIX_MAX;
        for (uint256 i = 0; i < self.size; i++) {
            Fix tokBal = toFix(self.collateral[i].erc20().balanceOf(account)); // {qTok}
            Fix q = self.quantity(self.collateral[i]); // {qTok/BU}
            if (q.gt(FIX_ZERO)) {
                // {BU} = {qTok} / {qTok/BU}
                Fix potential = tokBal.div(q);
                if (potential.lt(bal)) {
                    bal = potential;
                }
            }
        }
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function price(Basket storage self) internal view returns (Fix p) {
        for (uint256 i = 0; i < self.size; i++) {
            ICollateral c = ICollateral(self.collateral[i]);

            if (c.status() != CollateralStatus.DISABLED) {
                // {UoA/BU} = {UoA/BU} + {UoA/tok} * {qTok/BU} / {qTok/tok}
                p = p.plus(c.price().mul(self.quantity(c)).shiftLeft(-int8(c.erc20().decimals())));
            }
        }
    }
}
