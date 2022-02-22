// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Basket.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";

// import "hardhat/console.sol";

struct BackupConfig {
    uint256 maxCollateral; // Maximum number of backup collateral elements to use in a basket
    ICollateral[] collateral; // Ordered list of backup collateral
    // Can share ERC20s; does not have to be registered with the AssetRegistry!
}

struct BasketConfig {
    // The collateral in the prime (explicitly governance-set) basket
    ICollateral[] collateral;
    // An enumeration of the target names in collateral
    EnumerableSet.Bytes32Set targetNames;
    // Amount of target units per basket for each prime collateral. {target/BU}
    mapping(ICollateral => Fix) targetAmts;
    // Backup configurations, one per target name.
    mapping(bytes32 => BackupConfig) backups;
}

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */
contract BasketHandlerP0 is Pausable, Mixin, SettingsHandlerP0, AssetRegistryP0, IBasketHandler {
    using BasketLib for Basket;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for Fix;

    BasketConfig private config;

    Basket private basket;

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
        forceCollateralUpdates();
        if (worstCollateralStatus() == CollateralStatus.DISABLED) {
            _switchBasket();
        }
    }

    /// Register all provided collateral and set the prime basket in the basket configuration
    /// @dev This may de-register other collateral!
    /// @param collateral The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setPrimeBasket(ICollateral[] memory collateral, Fix[] memory targetAmts)
        public
        override
        onlyOwner
    {
        require(collateral.length == targetAmts.length, "must be same length");
        delete config.collateral;

        for (uint256 i = 0; i < collateral.length; i++) {
            ICollateral coll = collateral[i];
            _registerAsset(IAsset(address(coll))); // enforces ERC20 uniqueness

            config.collateral.push(coll);
            config.targetAmts[coll] = targetAmts[i];
            config.targetNames.add(coll.targetName());
        }

        emit PrimeBasketSet(collateral, targetAmts);
    }

    /// Set the backup configuration for some target name.
    function setBackupConfig(
        bytes32 targetName,
        uint256 maxCollateral,
        ICollateral[] memory collateral
    ) public override onlyOwner {
        BackupConfig storage conf = config.backups[targetName];
        conf.maxCollateral = maxCollateral;

        delete conf.collateral;
        for (uint256 i = 0; i < collateral.length; i++) {
            conf.collateral.push(collateral[i]);
        }
        emit BackupConfigSet(targetName, maxCollateral, collateral);
    }

    /// @return true if we registered a change in the underlying reference basket
    function switchBasket() public override onlyOwner returns (bool) {
        return _switchBasket();
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCapitalized() public view override returns (bool) {
        return basketsHeld().gte(rToken().basketsNeeded());
    }

    function basketNonce() public view override returns (uint256) {
        return basket.nonce;
    }

    /// @return status The maximum CollateralStatus among basket collateral
    function worstCollateralStatus() public view override returns (CollateralStatus status) {
        for (uint256 i = 0; i < basket.collateral.length; i++) {
            if (!isTrustworthyCollateral(ICollateral(basket.collateral[i]))) {
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
            // Exclude collateral that has defaulted
            if (
                !assets[i].isCollateral() ||
                isTrustworthyCollateral(ICollateral(address(assets[i])))
            ) {
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

            if (isTrustworthyCollateral(c)) {
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
            collateral[i] = ICollateral(basket.collateral[i]);

            // {qTok} = {BU} * {qTok/BU}
            quantities[i] = amount.mul(basketQuantity(collateral[i])).toUint(rounding);
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
            ICollateral c = ICollateral(basket.collateral[i]);

            Fix tokBal = toFix(c.erc20().balanceOf(account)); // {qTok}
            Fix q = basketQuantity(c); // {qTok/BU}
            if (q.gt(FIX_ZERO)) {
                // {BU} = {qTok} / {qTok/BU}
                Fix potential = tokBal.div(q);
                if (potential.lt(baskets)) {
                    baskets = potential;
                }
            }
        }
    }

    // newBasket is effectively a local variable of _switchBasket. Nothing should use its value
    // from a previous transaction.
    Basket private newBasket;

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    /// @return whether or not a new basket was derived from templates
    function _switchBasket() private returns (bool) {
        newBasket.empty();

        // Here, "good" collateral is non-defaulted collateral; any status other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with config.targetNames

        // {target/BU} total target weight of good, prime collateral with target i
        Fix[] memory goodWeights = new Fix[](config.targetNames.length());

        // {target/BU} total target weight of all prime collateral with target i
        Fix[] memory totalWeights = new Fix[](config.targetNames.length());

        // For each prime collateral:
        for (uint256 i = 0; i < config.collateral.length; i++) {
            ICollateral coll = config.collateral[i];

            // Find coll's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < config.targetNames.length(); targetIndex++) {
                if (config.targetNames.at(targetIndex) == coll.targetName()) break;
            }
            assert(targetIndex < config.targetNames.length());

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            Fix targetWeight = config.targetAmts[coll];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (isTrustworthyCollateral(coll)) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                newBasket.add(coll, targetWeight.div(coll.targetPerRef()));
            }
        }

        // For each target i, if we still need more weight for target i then try to add the backup
        // basket for target i to make up that weight:
        for (uint256 i = 0; i < config.targetNames.length(); i++) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need backup weight

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = config.backups[config.targetNames.at(i)];

            // Find the backup basket size: min(maxCollateral, # of good backup collateral)
            for (uint256 j = 0; j < backup.collateral.length; j++) {
                if (isTrustworthyCollateral(backup.collateral[j])) {
                    size++;
                    if (size >= backup.maxCollateral) break;
                }
            }

            // If we need backup collateral, but there's no good backup collateral, it's a bad case!
            // Do not set the basket; the protocol will stay issuance-paused until governance acts.
            if (size == 0) return false;

            // Set backup basket weights
            uint256 assigned = 0;
            for (uint256 j = 0; j < backup.collateral.length && assigned < size; j++) {
                ICollateral coll = backup.collateral[j];
                if (isTrustworthyCollateral(coll)) {
                    newBasket.add(coll, totalWeights[i].minus(goodWeights[i]).divu(size));
                    assigned++;
                }
            }
        }

        // If we haven't already given up, then commit the new basket!
        basket.copy(newBasket);

        // Keep records, emit event
        Fix[] memory refAmts = new Fix[](basket.collateral.length);
        for (uint256 i = 0; i < basket.collateral.length; i++) {
            refAmts[i] = basket.refAmts[basket.collateral[i]];
        }
        emit BasketSet(basket.collateral, refAmts);

        return true;
    }

    /// A collateral is "good" if it is both registered and not defaulted
    function isTrustworthyCollateral(ICollateral coll) private view returns (bool) {
        return isRegistered(coll) && coll.status() != CollateralStatus.DISABLED;
    }
}
