// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";

struct Target {
    Fix targetAmt; // {target/BU}
    uint256 maxCollateral; // Maximum number of collateral (from this target) to use in a basket
    ICollateral[] collateral; // Ordered list of potential collateral, not necessarily registered
    // Not all backup collateral needs to be registered with the registry. It will be skipped
    mapping(ICollateral => Fix) maxWeights; // {target/BU} Maximum weight per collateral
}

/// What the RToken is trying to track and strategies for accomplishing that, at a high-level
struct TargetBasket {
    EnumerableSet.Bytes32Set targetNames;
    mapping(bytes32 => Target) targets;
}

/// A specific definition of a BU that evolves over time as collateral selections change
struct ReferenceBasket {
    // Invariant: all reference basket collateral must be registered with the registry
    ICollateral[] collateral;
    mapping(ICollateral => Fix) refAmts; // {ref/BU}
    uint256 blockLastSet; // block number
}

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */
contract BasketHandlerP0 is Pausable, Mixin, SettingsHandlerP0, AssetRegistryP0, IBasketHandler {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for Fix;

    // The Target Basket is a linear combination of some number of targets, each
    // of which has a targetAmt and an ordered set of potential collateral to use.
    TargetBasket private config;

    // The Reference Basket is derived from the Target Basket on basket change
    ReferenceBasket private basket;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, AssetRegistryP0)
    {
        super.init(args);
    }

    /// Force an update for all collateral that could be swapped into the basket
    function forceCollateralUpdates() public override {
        IAsset[] memory assets = allAssets();
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].isCollateral()) {
                ICollateral(address(assets[i])).forceUpdates();
            }
        }
    }

    /// Try to ensure a new valid basket
    function ensureValidBasket() public override notPaused {
        if (worstCollateralStatus() == CollateralStatus.DISABLED) {
            deriveReferenceBasket();
        }
    }

    /// Set the target basket and set the reference basket to the supplied args
    /// Overrides all Targets that were previously set
    /// At the end of this function the reference basket collateral should equal `collateral`
    /// @param collateral The collateral for the new basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new basket
    function setTargetBasket(ICollateral[] memory collateral, Fix[] memory targetAmts)
        external
        override
        onlyOwner
    {
        require(collateral.length == targetAmts.length, "must be same length");

        // Clear TargetBasket
        while (config.targetNames.length() > 0) {
            bytes32 targetName = config.targetNames.at(0);
            delete config.targets[targetName];
            config.targetNames.remove(targetName);
        }

        // Add collateral to basket and config
        for (uint256 i = 0; i < collateral.length; i++) {
            ICollateral c = collateral[i];
            c.forceUpdates();
            require(c.status() == CollateralStatus.SOUND, "only sound collateral");

            config.targetNames.add(c.targetName());
            _registerAssetIgnoringCollisions(c);

            Target storage target = config.targets[c.targetName()];
            target.targetAmt = target.targetAmt.plus(targetAmts[i]);
            target.collateral.push(c);
            target.maxWeights[c] = targetAmts[i];
            target.maxCollateral = target.collateral.length;
        }

        emit TargetBasketSet(collateral, targetAmts);
        require(deriveReferenceBasket(), "cannot derive valid basket");

        // Post-checks
        assert(basket.collateral.length == collateral.length);
        assert(basket.blockLastSet == block.number);
        for (uint256 i = 0; i < collateral.length; i++) {
            ICollateral c = collateral[i];
            assert(basket.collateral[i] == c);
            assert(config.targets[c.targetName()].maxWeights[c].eq(targetAmts[i]));
        }
    }

    /// Set a target configuration, while leaving the target amount unchanged
    /// @param targetName The maximum number of backup tokens to use at once for `targetName`
    /// @param maxCollateral The maximum number of collateral tokens to use from this target
    /// @param collateral A list of ordered backup collateral, not necessarily registered
    /// @param maxWeights The corresponding maximum weights per basket unit, for each collateral
    function setTarget(
        bytes32 targetName,
        uint256 maxCollateral,
        ICollateral[] calldata collateral,
        Fix[] calldata maxWeights
    ) external override onlyOwner {
        require(collateral.length == maxWeights.length, "provide weights for each collateral");
        config.targetNames.add(targetName);
        config.targets[targetName].maxCollateral;
        config.targets[targetName].collateral = collateral;
        for (uint256 i = 0; i < collateral.length; i++) {
            config.targets[targetName].maxWeights[collateral[i]] = maxWeights[i];
        }
        emit TargetConfigured(targetName, maxCollateral, collateral, maxWeights);
    }

    /// @return true if we registered a change in the underlying reference basket
    function switchBasket() public override onlyOwner returns (bool) {
        return deriveReferenceBasket();
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCapitalized() public view override returns (bool) {
        return basketsHeld().gte(rToken().basketsNeeded());
    }

    function blockBasketLastChanged() public view override returns (uint256) {
        return basket.blockLastSet;
    }

    /// @return status The maximum CollateralStatus among basket collateral
    function worstCollateralStatus() public view override returns (CollateralStatus status) {
        for (uint256 i = 0; i < basket.collateral.length; i++) {
            if (!isSafeCollateral(basket.collateral[i])) {
                return CollateralStatus.DISABLED;
            }
            if (uint256(basket.collateral[i].status()) > uint256(status)) {
                status = basket.collateral[i].status();
            }
        }
    }

    /// @return total {UoA} An estimate of the total value of all assets held
    function totalAssetValue() public view override returns (Fix total) {
        IAsset[] memory assets = allAssets();
        for (uint256 i = 0; i < assets.length; i++) {
            ICollateral c = ICollateral(address(assets[i]));

            // Exclude collateral that has defaulted
            if (!assets[i].isCollateral() || c.status() != CollateralStatus.DISABLED) {
                uint256 bal = assets[i].erc20().balanceOf(address(this));

                // {UoA/tok} = {UoA/tok} * {qTok} / {qTok/tok}
                Fix p = assets[i].price().mulu(bal).shiftLeft(-int8(assets[i].erc20().decimals()));
                total = total.plus(p);
            }
        }
    }

    // ==== Internal ====

    /// @return {qTok/BU} The quantity of collateral in the basket
    function basketQuantity(ICollateral c) internal view returns (Fix) {
        // {qTok/BU} = {ref/BU} / {ref/tok} * {qTok/tok}
        return basket.refAmts[c].div(c.refPerTok()).shiftLeft(int8(c.erc20().decimals()));
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function basketPrice() internal view returns (Fix p) {
        for (uint256 i = 0; i < basket.collateral.length; i++) {
            ICollateral c = ICollateral(basket.collateral[i]);

            if (c.status() != CollateralStatus.DISABLED) {
                // {UoA/BU} = {UoA/BU} + {UoA/tok} * {qTok/BU} / {qTok/tok}
                p = p.plus(c.price().mul(basketQuantity(c)).shiftLeft(-int8(c.erc20().decimals())));
            }
        }
    }

    /// @param amount {BU}
    /// @return collateral The backing collateral
    /// @return quantities {qTok} Collateral token quantities equal to `amount` BUs
    function basketQuote(Fix amount, RoundingApproach rounding)
        internal
        view
        returns (ICollateral[] memory collateral, uint256[] memory quantities)
    {
        collateral = new ICollateral[](basket.collateral.length);
        quantities = new uint256[](basket.collateral.length);
        for (uint256 i = 0; i < basket.collateral.length; i++) {
            collateral[i] = basket.collateral[i];

            // {qTok} = {BU} * {qTok/BU}
            quantities[i] = amount.mul(basketQuantity(basket.collateral[i])).toUint(rounding);
        }
    }

    /// @return {BU} The number of basket units of collateral at an address
    function basketsHeld() internal view returns (Fix) {
        return basketsHeldBy(address(this));
    }

    /// @return baskets {BU} The balance of basket units held by `account`
    function basketsHeldBy(address account) internal view returns (Fix baskets) {
        baskets = FIX_MAX;
        for (uint256 i = 0; i < basket.collateral.length; i++) {
            Fix tokBal = toFix(basket.collateral[i].erc20().balanceOf(account)); // {qTok}
            Fix q = basketQuantity(basket.collateral[i]); // {qTok/BU}
            if (q.gt(FIX_ZERO)) {
                // {BU} = {qTok} / {qTok/BU}
                Fix potential = tokBal.div(q);
                if (potential.lt(baskets)) {
                    baskets = potential;
                }
            }
        }
    }

    /// Select and save the next reference basket from the target basket
    /// @return If the current reference basket is aligned with the target basket
    function deriveReferenceBasket() private returns (bool) {
        delete basket;

        // {target/BU} total weights of good collateral
        Fix[] memory goodWeights = new Fix[](config.targetNames.length());

        // For each target i, greedily construct baskets by pulling from backup collateral
        for (uint256 i = 0; i < config.targetNames.length(); i++) {
            Target storage target = config.targets[config.targetNames.at(i)];

            uint256 size = 0; // backup basket size
            for (uint256 j = 0; j < target.collateral.length && size < target.maxCollateral; j++) {
                ICollateral c = target.collateral[j];

                // Populate basket greedily from backup collateral
                if (isSafeCollateral(c) && target.maxWeights[c].gt(FIX_ZERO)) {
                    Fix weightMissing = target.targetAmt.minus(goodWeights[i]);
                    Fix weightToUse = fixMin(target.maxWeights[c], weightMissing);
                    goodWeights[i] = goodWeights[i].plus(weightToUse);

                    basket.collateral.push(c);
                    basket.refAmts[c] = weightToUse.div(c.targetPerRef());
                    size++;
                }
            }

            if (target.targetAmt.lte(goodWeights[i])) continue; // Target met

            // If there's no good target collateral left, do not set the basket
            // The protocol will stay issuance-paused until governance acts
            if (size == 0) return false;

            // Otherwise, multiply the already-included collateral weights by a scalar
            Fix scalar = target.targetAmt.div(goodWeights[i]);
            for (uint256 j = 0; j < size; j++) {
                ICollateral c = basket.collateral[j];
                basket.refAmts[c] = basket.refAmts[c].mul(scalar);
            }
        }

        // Keep records, emit event
        Fix[] memory refAmts = new Fix[](basket.collateral.length);
        for (uint256 i = 0; i < refAmts.length; i++) {
            refAmts[i] = basket.refAmts[basket.collateral[i]];
        }
        emit ReferenceBasketSet(basket.collateral, refAmts);
        basket.blockLastSet = block.number;
        return true;
    }

    /// A collateral is "good" if it is both registered and not defaulted
    function isSafeCollateral(ICollateral coll) private view returns (bool) {
        return isRegistered(coll) && coll.status() != CollateralStatus.DISABLED;
    }
}
