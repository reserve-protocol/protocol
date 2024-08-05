// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import "../../interfaces/IAssetRegistry.sol";
import "../../libraries/Fixed.sol";

// A "valid collateral array" is a IERC20[] array without rtoken/rsr/stRSR/zero address/duplicates

// A BackupConfig value is valid if erc20s is a valid collateral array
struct BackupConfig {
    uint256 max; // Maximum number of backup collateral erc20s to use in a basket
    IERC20[] erc20s; // Ordered list of backup collateral ERC20s
}

// What does a BasketConfig value mean?
//
// erc20s, targetAmts, and targetNames should be interpreted together.
// targetAmts[erc20] is the quantity of target units of erc20 that one BU should hold
// targetNames[erc20] is the name of erc20's target unit
// and then backups[tgt] is the BackupConfig to use for the target unit named tgt
//
// For any valid BasketConfig value:
//     erc20s == keys(targetAmts) == keys(targetNames)
//     if name is in values(targetNames), then backups[name] is a valid BackupConfig
//     erc20s is a valid collateral array
//
// In the meantime, treat erc20s as the canonical set of keys for the target* maps
struct BasketConfig {
    // The collateral erc20s in the prime (explicitly governance-set) basket
    IERC20[] erc20s;
    // Amount of target units per basket for each prime collateral token. {target/BU}
    mapping(IERC20 => uint192) targetAmts;
    // Cached view of the target unit for each erc20 upon setup
    mapping(IERC20 => bytes32) targetNames;
    // Backup configurations, per target name.
    mapping(bytes32 => BackupConfig) backups;
}

/// The type of BasketHandler.basket.
/// Defines a basket unit (BU) in terms of reference amounts of underlying tokens
// Logically, basket is just a mapping of erc20 addresses to ref-unit amounts.
//
// A Basket is valid if erc20s is a valid collateral array and erc20s == keys(refAmts)
struct Basket {
    IERC20[] erc20s; // enumerated keys for refAmts
    mapping(IERC20 => uint192) refAmts; // {ref/BU}
}

/**
 * @title BasketLibP1
 * @notice A helper library that implements a `nextBasket()` function for selecting a reference
 *   basket from the current basket config in combination with collateral statuses/exchange rates.
 */
library BasketLibP1 {
    using BasketLibP1 for Basket;
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for uint192;

    // === Basket Algebra ===

    /// Set self to a fresh, empty basket
    // self'.erc20s = [] (empty list)
    // self'.refAmts = {} (empty map)
    function empty(Basket storage self) internal {
        uint256 length = self.erc20s.length;
        for (uint256 i = 0; i < length; ++i) self.refAmts[self.erc20s[i]] = FIX_ZERO;
        delete self.erc20s;
    }

    /// Set `self` equal to `other`
    function setFrom(Basket storage self, Basket storage other) internal {
        empty(self);
        uint256 length = other.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            IERC20 _erc20 = other.erc20s[i]; // gas-saver
            self.erc20s.push(_erc20);
            self.refAmts[_erc20] = other.refAmts[_erc20];
        }
    }

    /// Add `weight` to the refAmount of collateral token `tok` in the basket `self`
    // self'.refAmts[tok] = self.refAmts[tok] + weight
    // self'.erc20s is keys(self'.refAmts)
    function add(
        Basket storage self,
        IERC20 tok,
        uint192 weight
    ) internal {
        // untestable:
        //      Both calls to .add() use a weight that has been CEIL rounded in the
        //      Fixed library div function, so weight will never be 0 here.
        //      Additionally, setPrimeBasket() enforces prime-basket tokens must have a weight > 0.
        if (weight == FIX_ZERO) return;
        if (self.refAmts[tok].eq(FIX_ZERO)) {
            self.erc20s.push(tok);
            self.refAmts[tok] = weight;
        } else {
            self.refAmts[tok] = self.refAmts[tok].plus(weight);
        }
    }

    // === Basket Selection ===

    /* nextBasket() computes basket' from three inputs:
       - the basket configuration (config: BasketConfig)
       - the function (isGood: erc20 -> bool), implemented here by goodCollateral()
       - the function (targetPerRef: erc20 -> Fix) implemented by the Collateral plugin

       ==== Definitions ====

       We use e:IERC20 to mean any erc20 token address, and tgt:bytes32 to mean any target name

       // targetWeight(b, e) is the target-unit weight of token e in basket b
       Let targetWeight(b, e) = b.refAmt[e] * targetPerRef(e)

       // backups(tgt) is the list of sound backup tokens we plan to use for target `tgt`.
       Let backups(tgt) = config.backups[tgt].erc20s
                          .filter(isGood)
                          .takeUpTo(config.backups[tgt].max)

       Let primeWt(e) = if e in config.erc20s and isGood(e)
                        then config.targetAmts[e]
                        else 0
       Let backupWt(e) = if e in backups(tgt)
                         then unsoundPrimeWt(tgt) / len(Backups(tgt))
                         else 0
       Let unsoundPrimeWt(tgt) = sum(config.targetAmts[e]
                                     for e in config.erc20s
                                     where config.targetNames[e] == tgt and !isGood(e))

       ==== The correctness condition ====

       If unsoundPrimeWt(tgt) > 0 and len(backups(tgt)) == 0 for some tgt, then return false.
       Else, return true and targetWeight(basket', e) == primeWt(e) + backupWt(e) for all e.

       ==== Higher-level desideratum ====

       The resulting total target weights should equal the configured target weight. Formally:

       let configTargetWeight(tgt) = sum(config.targetAmts[e]
                                         for e in config.erc20s
                                         where targetNames[e] == tgt)

       let targetWeightSum(b, tgt) = sum(targetWeight(b, e)
                                         for e in config.erc20s
                                         where targetNames[e] == tgt)

       Given all that, if nextBasket() returns true, then for all tgt,
           targetWeightSum(basket', tgt) == configTargetWeight(tgt)
    */

    /// Select next reference basket from basket config
    /// Works in-place on `newBasket`
    /// @param targetNames Scratch space for computation; initial value unused
    /// @param newBasket Scratch space for computation; initial value unused
    /// @param config The current basket configuration
    /// @return success result; i.e newBasket can be expected to contain a valid reference basket
    function nextBasket(
        Basket storage newBasket,
        EnumerableSet.Bytes32Set storage targetNames,
        BasketConfig storage config,
        IAssetRegistry assetRegistry
    ) external returns (bool) {
        // targetNames := {}
        while (targetNames.length() != 0) {
            targetNames.remove(targetNames.at(targetNames.length() - 1));
        }

        // newBasket := {}
        newBasket.empty();

        // targetNames = set(values(config.targetNames))
        // (and this stays true; targetNames is not touched again in this function)
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            targetNames.add(config.targetNames[config.erc20s[i]]);
        }
        uint256 targetsLength = targetNames.length();

        // "good" collateral is collateral with any status() other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with targetNames
        // As such, they're each interepreted as a map from target name -> target weight

        // {target/BU} total target weight of good, prime collateral with target i
        // goodWeights := {}
        uint192[] memory goodWeights = new uint192[](targetsLength);

        // {target/BU} total target weight of all prime collateral with target i
        // totalWeights := {}
        uint192[] memory totalWeights = new uint192[](targetsLength);

        // For each prime collateral token:
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            // Find collateral's targetName index
            uint256 targetIndex;
            IERC20 _erc20 = config.erc20s[i]; // gas-saver
            for (targetIndex = 0; targetIndex < targetsLength; ++targetIndex) {
                if (targetNames.at(targetIndex) == config.targetNames[_erc20]) break;
            }
            assert(targetIndex < targetsLength);
            // now, targetNames[targetIndex] == config.targetNames[erc20]

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            uint192 targetWeight = config.targetAmts[_erc20];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (
                goodCollateral(config.targetNames[_erc20], _erc20, assetRegistry) &&
                targetWeight.gt(FIX_ZERO)
            ) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                newBasket.add(
                    _erc20,
                    targetWeight.div(
                        // this div is safe: targetPerRef() > 0: goodCollateral check
                        assetRegistry.toColl(_erc20).targetPerRef(),
                        CEIL
                    )
                );
            }
        }

        // Analysis: at this point:
        // for all tgt in target names,
        //   totalWeights(tgt)
        //   = sum(config.targetAmts[e] for e in config.erc20s where targetNames[e] == tgt), and
        //   goodWeights(tgt)
        //   = sum(primeWt(e) for e in config.erc20s where targetNames[e] == tgt)
        // for all e in config.erc20s,
        //   targetWeight(newBasket, e)
        //   = sum(primeWt(e) if goodCollateral(e), else 0)

        // For each tgt in target names, if we still need more weight for tgt then try to add the
        // backup basket for tgt to make up that weight:
        for (uint256 i = 0; i < targetsLength; ++i) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need any backup weight
            bytes32 _targetName = targetNames.at(i);

            // "tgt" = targetNames[i]
            // Now, unsoundPrimeWt(tgt) > 0

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = config.backups[_targetName];

            // Find the backup basket size: min(backup.max, # of good backup collateral)
            for (uint256 j = 0; j < backup.erc20s.length && size < backup.max; ++j) {
                if (goodCollateral(_targetName, backup.erc20s[j], assetRegistry)) size++;
            }

            // Now, size = len(backups(tgt)). If empty, fail.
            if (size == 0) return false;

            // Set backup basket weights...
            uint256 assigned = 0;

            // Loop: for erc20 in backups(tgt)...
            for (uint256 j = 0; j < backup.erc20s.length && assigned < size; ++j) {
                if (goodCollateral(_targetName, backup.erc20s[j], assetRegistry)) {
                    uint192 backupWeight = totalWeights[i].minus(goodWeights[i]).div(
                        // this div is safe: targetPerRef > 0: goodCollateral check
                        assetRegistry.toColl(backup.erc20s[j]).targetPerRef().mulu(size),
                        CEIL
                    );

                    // Across this .add(), targetWeight(newBasket',erc20)
                    // = targetWeight(newBasket,erc20) + unsoundPrimeWt(tgt) / len(backups(tgt))
                    BasketLibP1.add(newBasket, backup.erc20s[j], backupWeight);
                    assigned++;
                }
            }
            // Here, targetWeight(newBasket, e) = primeWt(e) + backupWt(e) for all e targeting tgt
        }
        // Now we've looped through all values of tgt, so for all e,
        //   targetWeight(newBasket, e) = primeWt(e) + backupWt(e)

        return newBasket.erc20s.length != 0;
    }

    // === Private ===

    /// Good collateral is registered, collateral, SOUND, has the expected targetName,
    /// has nonzero targetPerRef() and refPerTok(), and is not a system token or 0 addr
    function goodCollateral(
        bytes32 targetName,
        IERC20 erc20,
        IAssetRegistry assetRegistry
    ) private view returns (bool) {
        // untestable:
        //      ERC20 is not address(0), validated when setting prime/backup baskets
        if (address(erc20) == address(0)) return false;
        // P1 gas optimization
        // We do not need to check that the ERC20 is not a system token
        // BasketHandlerP1.requireValidCollArray() has been run on all ERC20s already

        try assetRegistry.toColl(erc20) returns (ICollateral coll) {
            return
                targetName == coll.targetName() &&
                coll.status() == CollateralStatus.SOUND &&
                coll.refPerTok() != 0 &&
                coll.targetPerRef() != 0;
        } catch {
            return false;
        }
    }

    // === Contract-size savers ===

    /// Require that erc20s and targetAmts preserve the current config targets
    /// @param _targetAmts Scratch space for computation; assumed to be empty
    function requireConstantConfigTargets(
        IAssetRegistry assetRegistry,
        BasketConfig storage config,
        EnumerableMap.Bytes32ToUintMap storage _targetAmts,
        IERC20[] calldata erc20s,
        uint192[] calldata targetAmts
    ) external {
        // Populate _targetAmts mapping with old basket config
        uint256 len = config.erc20s.length;
        for (uint256 i = 0; i < len; ++i) {
            IERC20 erc20 = config.erc20s[i];
            bytes32 targetName = config.targetNames[erc20];
            (bool contains, uint256 amt) = _targetAmts.tryGet(targetName);
            _targetAmts.set(
                targetName,
                contains ? amt + config.targetAmts[erc20] : config.targetAmts[erc20]
            );
        }

        // Require new basket is exactly equal to old basket, in terms of target amounts
        len = erc20s.length;
        for (uint256 i = 0; i < len; ++i) {
            bytes32 targetName = assetRegistry.toColl(erc20s[i]).targetName();
            (bool contains, uint256 amt) = _targetAmts.tryGet(targetName);
            require(contains && amt >= targetAmts[i], "new target weights");
            if (amt > targetAmts[i]) _targetAmts.set(targetName, amt - targetAmts[i]);
            else _targetAmts.remove(targetName);
        }
        require(_targetAmts.length() == 0, "missing target weights");
    }

    /// Normalize the target amounts to maintain constant UoA value with the current config
    /// @dev Unused; left in for future use in reweightable RToken forceSetPrimeBasket() spell
    /// @param price {UoA/BU} Price of the reference basket (point estimate)
    /// @return newTargetAmts {target/BU} The new target amounts for the normalized basket
    function normalizeByPrice(
        IAssetRegistry assetRegistry,
        IERC20[] calldata erc20s,
        uint192[] calldata targetAmts,
        uint192 price
    ) external view returns (uint192[] memory newTargetAmts) {
        uint256 len = erc20s.length; // assumes erc20s.length == targetAmts.length

        // Rounding in this function should always be in favor of RToken holders

        // Compute would-be new price
        uint192 newPrice; // {UoA/BU}
        for (uint256 i = 0; i < len; ++i) {
            ICollateral coll = assetRegistry.toColl(erc20s[i]); // reverts if unregistered
            require(coll.status() == CollateralStatus.SOUND, "unsound new collateral");

            (uint192 low, uint192 high) = coll.price(); // {UoA/tok}
            require(low != 0 && high != FIX_MAX, "invalid price");

            // {UoA/BU} += {target/BU} * {UoA/tok} / ({target/ref} * {ref/tok})
            newPrice += targetAmts[i].mulDiv(
                (low + high) / 2,
                coll.targetPerRef().mul(coll.refPerTok(), CEIL),
                FLOOR
            ); // revert on overflow
        }

        // Scale targetAmts by the price ratio
        newTargetAmts = new uint192[](len);
        for (uint256 i = 0; i < len; ++i) {
            // {target/BU} = {target/BU} * {UoA/BU} / {UoA/BU}
            newTargetAmts[i] = targetAmts[i].mulDiv(price, newPrice, CEIL);
        }
    }
}
