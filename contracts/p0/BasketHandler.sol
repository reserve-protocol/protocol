// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/libraries/Array.sol";
import "contracts/libraries/Fixed.sol";

// A "valid collateral array" is a an IERC20[] value without rtoken, rsr, or any duplicate values

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
// In the analytical comments I'll just refer to it that way.
//
// A Basket is valid if erc20s is a valid collateral array and erc20s == keys(refAmts)
struct Basket {
    IERC20[] erc20s; // enumerated keys for refAmts
    mapping(IERC20 => uint192) refAmts; // {ref/BU}
}

/*
 * @title BasketLibP0
 */
library BasketLibP0 {
    using BasketLibP0 for Basket;
    using FixLib for uint192;

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
            self.erc20s.push(other.erc20s[i]);
            self.refAmts[other.erc20s[i]] = other.refAmts[other.erc20s[i]];
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
        if (weight == FIX_ZERO) return;
        if (self.refAmts[tok].eq(FIX_ZERO)) {
            self.erc20s.push(tok);
            self.refAmts[tok] = weight;
        } else {
            self.refAmts[tok] = self.refAmts[tok].plus(weight);
        }
    }
}

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */
contract BasketHandlerP0 is ComponentP0, IBasketHandler {
    using BasketLibP0 for Basket;
    using CollateralStatusComparator for CollateralStatus;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for uint192;

    uint192 public constant MAX_TARGET_AMT = 1e3 * FIX_ONE; // {target/BU} max basket weight

    // config is the basket configuration, from which basket will be computed in a basket-switch
    // event. config is only modified by governance through setPrimeBakset and setBackupConfig
    BasketConfig private config;

    // basket, disabled, nonce, and timestamp are only ever set by `_switchBasket()`
    // basket is the current basket.
    Basket private basket;

    uint48 public override nonce; // A unique identifier for this basket instance
    uint48 public override timestamp; // The timestamp when this basket was last set

    // If disabled is true, status() is DISABLED, the basket is invalid, and the whole system should
    // be paused.
    bool private disabled;

    // ==== Invariants ====
    // basket is a valid Basket:
    //   basket.erc20s is a valid collateral array and basket.erc20s == keys(basket.refAmts)
    // config is a valid BasketConfig:
    //   erc20s == keys(targetAmts) == keys(targetNames)
    //   erc20s is a valid collateral array
    //   for b in vals(backups), b.erc20s is a valid collateral array.
    // if basket.erc20s is empty then disabled == true

    // BasketHandler.init() just leaves the BasketHandler state zeroed
    function init(IMain main_) external initializer {
        __Component_init(main_);
        disabled = true;
    }

    /// Disable the basket in order to schedule a basket refresh
    /// @custom:protected
    // checks: caller is assetRegistry
    // effects: disabled' = true
    function disableBasket() external {
        require(_msgSender() == address(main.assetRegistry()), "asset registry only");
        uint192[] memory refAmts = new uint192[](basket.erc20s.length);
        emit BasketSet(nonce, basket.erc20s, refAmts, true);
        disabled = true;
    }

    /// Switch the basket, only callable directly by governance
    /// @custom:interaction OR @custom:governance
    // checks: either caller has OWNER,
    //         or (basket is disabled after refresh and we're unpaused and unfrozen)
    // actions: calls assetRegistry.refresh(), then _switchBasket()
    // effects:
    //   Either: (basket' is a valid nonempty basket, without DISABLED collateral,
    //            that satisfies basketConfig) and disabled' = false
    //   Or no such basket exists and disabled' = true
    function refreshBasket() external {
        main.assetRegistry().refresh();

        require(
            main.hasRole(OWNER, _msgSender()) ||
                (status() == CollateralStatus.DISABLED && !main.pausedOrFrozen()),
            "basket unrefreshable"
        );
        _switchBasket();
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    // checks:
    //   caller is OWNER
    //   len(erc20s) == len(targetAmts)
    //   erc20s is a valid collateral array
    //   for all i, erc20[i] is in AssetRegistry as collateral
    //   for all i, 0 < targetAmts[i] <= MAX_TARGET_AMT == 1000
    //
    // effects:
    //   config'.erc20s = erc20s
    //   config'.targetAmts[erc20s[i]] = targetAmts[i], for i from 0 to erc20s.length-1
    //   config'.targetNames[e] = reg.toColl(e).targetName, for e in erc20s
    function setPrimeBasket(IERC20[] calldata erc20s, uint192[] calldata targetAmts)
        external
        governance
    {
        require(erc20s.length > 0, "cannot empty basket");
        require(erc20s.length == targetAmts.length, "must be same length");
        requireValidCollArray(erc20s);

        // Clean up previous basket config
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            delete config.targetAmts[config.erc20s[i]];
            delete config.targetNames[config.erc20s[i]];
        }
        delete config.erc20s;

        // Set up new config basket
        IAssetRegistry reg = main.assetRegistry();
        bytes32[] memory names = new bytes32[](erc20s.length);

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the prime basket to have its asset unregistered.
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");
            require(0 < targetAmts[i], "invalid target amount; must be nonzero");
            require(targetAmts[i] <= MAX_TARGET_AMT, "invalid target amount; too large");

            config.erc20s.push(erc20s[i]);
            config.targetAmts[erc20s[i]] = targetAmts[i];
            names[i] = reg.toColl(erc20s[i]).targetName();
            config.targetNames[erc20s[i]] = names[i];
        }

        emit PrimeBasketSet(erc20s, targetAmts, names);
    }

    /// Set the backup configuration for some target name
    /// @custom:governance
    // checks:
    //   caller is OWNER
    //   erc20s is a valid collateral array
    //   for all i, erc20[i] is in AssetRegistry as collateral
    //
    // effects:
    //   config'.backups[targetName] = {max: max, erc20s: erc20s}
    function setBackupConfig(
        bytes32 targetName,
        uint256 max,
        IERC20[] calldata erc20s
    ) external governance {
        requireValidCollArray(erc20s);
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;
        delete conf.erc20s;
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the backup config to have its asset altered.
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");
            conf.erc20s.push(erc20s[i]);
        }
        emit BackupConfigSet(targetName, max, erc20s);
    }

    /// @return Whether this contract owns enough collateral to cover rToken.basketsNeeded() BUs
    /// ie, whether the protocol is currently fully collateralized
    function fullyCollateralized() external view returns (bool) {
        return basketsHeldBy(address(main.backingManager())) >= main.rToken().basketsNeeded();
    }

    /// @return status_ The status of the basket
    // returns DISABLED if disabled == true, and worst(status(coll)) otherwise
    function status() public view returns (CollateralStatus status_) {
        uint256 size = basket.erc20s.length;

        if (disabled || size == 0) return CollateralStatus.DISABLED;

        for (uint256 i = 0; i < size; ++i) {
            CollateralStatus s = main.assetRegistry().toColl(basket.erc20s[i]).status();
            if (s.worseThan(status_)) status_ = s;
        }
    }

    /// @return {tok/BU} The token-quantity of an ERC20 token in the basket.
    // Returns 0 if erc20 is not registered, disabled, or not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function quantity(IERC20 erc20) public view returns (uint192) {
        try main.assetRegistry().toColl(erc20) returns (ICollateral coll) {
            if (coll.status() == CollateralStatus.DISABLED) return FIX_ZERO;

            uint192 refPerTok = coll.refPerTok();
            if (refPerTok == 0) return FIX_MAX;
            // {tok/BU} = {ref/BU} / {ref/tok}
            return basket.refAmts[erc20].div(refPerTok, CEIL);
        } catch {
            return FIX_ZERO;
        }
    }

    /// @param allowFallback Whether to fail over to the fallback price or not
    /// @return isFallback If any fallback prices were used
    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    // returns sum(quantity(erc20) * price(erc20) for erc20 in basket.erc20s)
    function price(bool allowFallback) external view returns (bool isFallback, uint192 p) {
        uint256 length = basket.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            bool isFallback_; // Is this token's price a fallback price
            uint192 price_; // This token's price

            if (!allowFallback) {
                (isFallback_, price_) = main.assetRegistry().toAsset(basket.erc20s[i]).price(
                    allowFallback
                );
            } else {
                try main.assetRegistry().toAsset(basket.erc20s[i]) returns (IAsset asset) {
                    (isFallback_, price_) = asset.price(true);
                } catch {
                    isFallback_ = true;
                    price_ = 0;
                }
            }

            isFallback = isFallback || isFallback_;
            uint192 qty = quantity(basket.erc20s[i]);

            if (!allowFallback) {
                p = p.plus(price_.mul(qty));
            } else {
                try this.addProduct(p, price_, qty) returns (uint192 sum) {
                    p = sum;
                } catch {
                    return (true, FIX_MAX);
                }
            }
        }
    }

    // Returns a + (b * c). Pulled out into separate function for exception-catching in price()
    function addProduct(
        uint192 a,
        uint192 b,
        uint192 c
    ) external pure returns (uint192) {
        return a.plus(b.mul(c));
    }

    /// Return the current issuance/redemption value of `amount` BUs
    /// @param amount {BU}
    /// @return erc20s The backing collateral erc20s
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    // Returns (erc20s, [quantity(e) * amount {as qTok} for e in erc20s])
    function quote(uint192 amount, RoundingMode rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities)
    {
        uint256 length = basket.erc20s.length;
        erc20s = new address[](length);
        quantities = new uint256[](length);

        for (uint256 i = 0; i < length; ++i) {
            erc20s[i] = address(basket.erc20s[i]);

            // {qTok} = {tok/BU} * {BU} * {tok} * {qTok/tok}
            quantities[i] = quantity(basket.erc20s[i]).mul(amount, rounding).shiftl_toUint(
                int8(IERC20Metadata(address(basket.erc20s[i])).decimals()),
                rounding
            );
        }
    }

    /// @return baskets {BU} The balance of basket units held by `account`
    /// @dev Returns FIX_ZERO for an empty basket
    // Returns:
    //    0, if (basket.erc20s is empty) or (disabled is true) or (status() is DISABLED)
    //    min(e.balanceOf(account) / quantity(e) for e in basket.erc20s if quantity(e) > 0),
    function basketsHeldBy(address account) public view returns (uint192 baskets) {
        uint256 length = basket.erc20s.length;
        if (length == 0 || disabled) return FIX_ZERO;
        baskets = FIX_MAX;

        for (uint256 i = 0; i < length; ++i) {
            ICollateral coll = main.assetRegistry().toColl(basket.erc20s[i]);
            if (coll.status() == CollateralStatus.DISABLED) return FIX_ZERO;

            uint192 refPerTok = coll.refPerTok();
            if (refPerTok == 0) return FIX_ZERO;
            uint192 bal = coll.bal(account); // {tok}

            // {tok/BU} = {ref/BU} / {ref/tok}
            uint192 q = basket.refAmts[basket.erc20s[i]].div(refPerTok, CEIL);

            // {BU} = either {BU} or {tok} / {tok/BU}; q > 0 because q = (n).div(_, CEIL) and n > 0
            baskets = fixMin(baskets, bal.div(q));
        }
    }

    /* _switchBasket computes basket' from three inputs:
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

       If unsoundPrimeWt(tgt) > 0 and len(backups(tgt)) == 0 for some tgt, then disabled' == true.
       Else, disabled' == false and targetWeight(basket', e) == primeWt(e) + backupWt(e) for all e.

       ==== Higher-level desideratum ====

       The resulting total target weights should equal the configured target weight. Formally:

       let configTargetWeight(tgt) = sum(config.targetAmts[e]
                                         for e in config.erc20s
                                         where targetNames[e] == tgt)

       let targetWeightSum(b, tgt) = sum(targetWeight(b, e)
                                         for e in config.erc20s
                                         where targetNames[e] == tgt)

       Given all that, if disabled' == false, then for all tgt,
           targetWeightSum(basket', tgt) == configTargetWeight(tgt)

       ==== Usual specs ====

       Then, finally, given all that, the effects of _switchBasket() are:
         basket' = newBasket, as defined above
         nonce' = nonce + 1
         timestamp' = now
    */

    // These are effectively local variables of _switchBasket.
    // Nothing should use their values from previous transactions.
    EnumerableSet.Bytes32Set private targetNames;
    Basket private newBasket; // Always empty

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    /// (The mutator that actually does all the work in this contract.)
    function _switchBasket() private {
        IAssetRegistry reg = main.assetRegistry();
        disabled = false;

        // targetNames := {}
        while (targetNames.length() > 0) targetNames.remove(targetNames.at(0));
        // newBasket := {}
        newBasket.empty();

        // targetNames = set(values(config.targetNames))
        // (and this stays true; targetNames is not touched again in this function)
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            targetNames.add(config.targetNames[config.erc20s[i]]);
        }

        // "good" collateral is collateral with any status() other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with targetNames
        // As such, they're each interepreted as a map from target name -> target weight

        // {target/BU} total target weight of good, prime collateral with target i
        // goodWeights := {}
        uint192[] memory goodWeights = new uint192[](targetNames.length());

        // {target/BU} total target weight of all prime collateral with target i
        // totalWeights := {}
        uint192[] memory totalWeights = new uint192[](targetNames.length());

        // For each prime collateral token:
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            IERC20 erc20 = config.erc20s[i];

            // Find collateral's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < targetNames.length(); ++targetIndex) {
                if (targetNames.at(targetIndex) == config.targetNames[erc20]) break;
            }
            assert(targetIndex < targetNames.length());
            // now, targetNames[targetIndex] == config.targetNames[config.erc20s[i]]

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            uint192 targetWeight = config.targetAmts[erc20];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (goodCollateral(config.targetNames[erc20], erc20) && targetWeight.gt(FIX_ZERO)) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                newBasket.add(erc20, targetWeight.div(reg.toColl(erc20).targetPerRef(), CEIL));
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
        for (uint256 i = 0; i < targetNames.length(); ++i) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need any backup weight

            // "tgt" = targetNames[i]
            // Now, unsoundPrimeWt(tgt) > 0

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = config.backups[targetNames.at(i)];

            // Find the backup basket size: min(backup.max, # of good backup collateral)
            for (uint256 j = 0; j < backup.erc20s.length && size < backup.max; ++j) {
                if (goodCollateral(targetNames.at(i), backup.erc20s[j])) size++;
            }

            // Now, size = len(backups(tgt)). Do the disable check:
            // Remove bad collateral and mark basket disabled. Pause most protocol functions
            if (size == 0) disabled = true;

            // Set backup basket weights...
            uint256 assigned = 0;
            // needed = unsoundPrimeWt(tgt)
            uint192 needed = totalWeights[i].minus(goodWeights[i]);

            // Loop: for erc20 in backups(tgt)...
            for (uint256 j = 0; j < backup.erc20s.length && assigned < size; ++j) {
                IERC20 erc20 = backup.erc20s[j];
                if (goodCollateral(targetNames.at(i), erc20)) {
                    // Across this .add(), targetWeight(newBasket',erc20)
                    // = targetWeight(newBasket,erc20) + unsoundPrimeWt(tgt) / len(backups(tgt))
                    newBasket.add(
                        erc20,
                        needed.div(reg.toColl(erc20).targetPerRef().mulu(size), CEIL)
                    );
                    assigned++;
                }
            }
            // Here, targetWeight(newBasket, e) = primeWt(e) + backupWt(e) for all e targeting tgt
        }
        // Now we've looped through all values of tgt, so for all e,
        //   targetWeight(newBasket, e) = primeWt(e) + backupWt(e)

        // Notice if basket is actually empty
        if (newBasket.erc20s.length == 0) disabled = true;

        // Update the basket if it's not disabled
        if (!disabled) {
            basket.setFrom(newBasket);
            nonce += 1;
            timestamp = uint48(block.timestamp);
        }

        // Keep records, emit event
        uint192[] memory refAmts = new uint192[](basket.erc20s.length);
        for (uint256 i = 0; i < basket.erc20s.length; ++i) {
            refAmts[i] = basket.refAmts[basket.erc20s[i]];
        }
        emit BasketSet(nonce, basket.erc20s, refAmts, disabled);
    }

    /// Require that erc20s is a valid collateral array
    function requireValidCollArray(IERC20[] calldata erc20s) internal view {
        IERC20 rsr = main.rsr();
        IERC20 rToken = IERC20(address(main.rToken()));
        IERC20 stRSR = IERC20(address(main.stRSR()));
        IERC20 zero = IERC20(address(0));

        for (uint256 i = 0; i < erc20s.length; i++) {
            require(erc20s[i] != rsr, "RSR is not valid collateral");
            require(erc20s[i] != rToken, "RToken is not valid collateral");
            require(erc20s[i] != stRSR, "stRSR is not valid collateral");
            require(erc20s[i] != zero, "address zero is not valid collateral");
        }

        require(ArrayLib.allUnique(erc20s), "contains duplicates");
    }

    /// Good collateral is registered, collateral, not DISABLED, has the expected targetName,
    /// and not a system token or 0 addr
    function goodCollateral(bytes32 targetName, IERC20 erc20) private view returns (bool) {
        if (erc20 == IERC20(address(0))) return false;
        if (erc20 == main.rsr()) return false;
        if (erc20 == IERC20(address(main.rToken()))) return false;
        if (erc20 == IERC20(address(main.stRSR()))) return false;

        try main.assetRegistry().toColl(erc20) returns (ICollateral coll) {
            return
                targetName == coll.targetName() &&
                coll.status() != CollateralStatus.DISABLED &&
                coll.refPerTok() > 0 &&
                coll.targetPerRef() > 0;
        } catch {
            return false;
        }
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[48] private __gap;
}
