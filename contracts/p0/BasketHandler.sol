// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IMain.sol";
import "./mixins/Component.sol";
import "../libraries/Array.sol";
import "../libraries/Fixed.sol";

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
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using FixLib for uint192;

    uint48 public constant MIN_WARMUP_PERIOD = 60; // {s} 1 minute
    uint48 public constant MAX_WARMUP_PERIOD = 31536000; // {s} 1 year
    uint192 public constant MAX_TARGET_AMT = 1e3 * FIX_ONE; // {target/BU} max basket weight
    uint256 internal constant MAX_BACKUP_ERC20S = 64;

    // config is the basket configuration, from which basket will be computed in a basket-switch
    // event. config is only modified by governance through setPrimeBasket and setBackupConfig
    BasketConfig private config;

    // basket, disabled, nonce, and timestamp are only ever set by `_switchBasket()`
    // basket is the current basket.
    Basket private basket;

    uint48 public nonce; // {basketNonce} A unique identifier for this basket instance
    uint48 public lastCollateralized; // {basketNonce} Nonce of most recent full collateralization
    uint48 public timestamp; // The timestamp when this basket was last set

    // If disabled is true, status() is DISABLED, the basket is invalid, and the whole system should
    // be paused.
    bool private disabled;

    // These are effectively local variables of _switchBasket.
    // Nothing should use their values from previous transactions.
    EnumerableSet.Bytes32Set private targetNames;
    Basket private newBasket;

    // Effectively local variable of `requireConstantConfigTargets()`
    EnumerableMap.Bytes32ToUintMap private _targetAmts; // targetName -> {target/BU}

    uint48 public warmupPeriod; // {s} how long to wait until issuance/trading after regaining SOUND

    // basket status changes, mainly set when `trackStatus()` is called
    // used to enforce warmup period, after regaining SOUND
    uint48 private lastStatusTimestamp;
    CollateralStatus private lastStatus;

    // A history of baskets by basket nonce; includes current basket
    mapping(uint48 => Basket) private basketHistory;

    // Whether the total weights of the target basket can be changed
    bool public reweightable; // immutable after init

    bool public enableIssuancePremium;

    // ==== Invariants ====
    // basket is a valid Basket:
    //   basket.erc20s is a valid collateral array and basket.erc20s == keys(basket.refAmts)
    // config is a valid BasketConfig:
    //   erc20s == keys(targetAmts) == keys(targetNames)
    //   erc20s is a valid collateral array
    //   for b in vals(backups), b.erc20s is a valid collateral array.
    // if basket.erc20s is empty then disabled == true

    // BasketHandler.init() just leaves the BasketHandler state zeroed
    function init(
        IMain main_,
        uint48 warmupPeriod_,
        bool reweightable_,
        bool enableIssuancePremium_
    ) external initializer {
        __Component_init(main_);

        setWarmupPeriod(warmupPeriod_);
        reweightable = reweightable_; // immutable thereafter
        enableIssuancePremium = enableIssuancePremium_;

        // Set last status to DISABLED (default)
        lastStatus = CollateralStatus.DISABLED;
        lastStatusTimestamp = uint48(block.timestamp);

        disabled = true;
    }

    /// Disable the basket in order to schedule a basket refresh
    /// @custom:protected
    // checks: caller is assetRegistry
    // effects: disabled' = true
    function disableBasket() external {
        require(_msgSender() == address(main.assetRegistry()), "asset registry only");

        uint192[] memory refAmts = new uint192[](basket.erc20s.length);
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            refAmts[i] = basket.refAmts[basket.erc20s[i]];
        }
        emit BasketSet(nonce, basket.erc20s, refAmts, true);
        disabled = true;

        trackStatus();
    }

    /// Switch the basket, only callable directly by governance or after a default
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
                (lastStatus == CollateralStatus.DISABLED && !main.tradingPausedOrFrozen()),
            "basket unrefreshable"
        );
        _switchBasket();

        trackStatus();
    }

    /// Track basket status and collateralization changes
    // effects: lastStatus' = status(), and lastStatusTimestamp' = current timestamp
    /// @custom:refresher
    function trackStatus() public {
        CollateralStatus currentStatus = status();
        if (currentStatus != lastStatus) {
            emit BasketStatusChanged(lastStatus, currentStatus);
            lastStatus = currentStatus;
            lastStatusTimestamp = uint48(block.timestamp);
        }

        // Invalidate old nonces if fully collateralized
        if (reweightable && nonce > lastCollateralized && fullyCollateralized()) {
            emit LastCollateralizedChanged(lastCollateralized, nonce);
            lastCollateralized = nonce;
        }
    }

    /// Set the prime basket, checking target amounts are constant
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    function setPrimeBasket(IERC20[] calldata erc20s, uint192[] calldata targetAmts)
        external
        governance
    {
        _setPrimeBasket(erc20s, targetAmts, false);
    }

    /// Set the prime basket, skipping any constant target amount checks if RToken is reweightable
    /// Warning: Reweightable RTokens SHOULD use a spell to execute this function to avoid
    ///          accidentally changing the UoA value of the RToken.
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    function forceSetPrimeBasket(IERC20[] calldata erc20s, uint192[] calldata targetAmts)
        external
        governance
    {
        _setPrimeBasket(erc20s, targetAmts, true);
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @param disableTargetAmountCheck If true, skips the `requireConstantConfigTargets()` check
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
    function _setPrimeBasket(
        IERC20[] calldata erc20s,
        uint192[] memory targetAmts,
        bool disableTargetAmountCheck
    ) internal {
        require(erc20s.length > 0, "invalid lengths");
        require(erc20s.length == targetAmts.length, "invalid lengths");
        requireValidCollArray(erc20s);

        if (
            (!reweightable || (reweightable && !disableTargetAmountCheck)) &&
            config.erc20s.length != 0
        ) {
            // Require targets remain constant
            requireConstantConfigTargets(erc20s, targetAmts);
        }

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
            require(reg.toAsset(erc20s[i]).isCollateral(), "erc20 is not collateral");
            require(0 < targetAmts[i], "invalid target amount");
            require(targetAmts[i] <= MAX_TARGET_AMT, "invalid target amount");

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
        require(max <= MAX_BACKUP_ERC20S, "too large");
        require(erc20s.length <= MAX_BACKUP_ERC20S, "too large");
        requireValidCollArray(erc20s);
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;
        delete conf.erc20s;
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the backup config to have its asset altered.
            require(reg.toAsset(erc20s[i]).isCollateral(), "erc20 is not collateral");
            conf.erc20s.push(erc20s[i]);
        }
        emit BackupConfigSet(targetName, max, erc20s);
    }

    /// @return Whether this contract owns enough collateral to cover rToken.basketsNeeded() BUs
    /// ie, whether the protocol is currently fully collateralized
    function fullyCollateralized() public view returns (bool) {
        BasketRange memory held = basketsHeldBy(address(main.backingManager()));
        return held.bottom >= main.rToken().basketsNeeded();
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

    /// @return Whether the basket is ready to issue and trade
    function isReady() external view returns (bool) {
        return
            status() == CollateralStatus.SOUND &&
            (block.timestamp >= lastStatusTimestamp + warmupPeriod);
    }

    /// Basket quantity rounded up, without any issuance premium
    /// @param erc20 The token contract to check for quantity for
    /// @return {tok/BU} The redemption token-quantity of an ERC20 token in the basket.
    // Returns 0 if erc20 is not registered or not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function quantity(IERC20 erc20) public view returns (uint192) {
        try main.assetRegistry().toColl(erc20) returns (ICollateral coll) {
            return _quantity(erc20, coll, CEIL);
        } catch {
            return FIX_ZERO;
        }
    }

    /// Basket quantity rounded up, without any issuance premium
    /// Like quantity(), but unsafe because it DOES NOT CONFIRM THAT THE ASSET IS CORRECT
    /// @param erc20 The ERC20 token contract for the asset
    /// @param asset The registered asset plugin contract for the erc20
    /// @return {tok/BU} The token-quantity of an ERC20 token in the basket.
    // Returns 0 if erc20 is not registered or not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function quantityUnsafe(IERC20 erc20, IAsset asset) public view returns (uint192) {
        if (!asset.isCollateral()) return FIX_ZERO;
        return _quantity(erc20, ICollateral(address(asset)), CEIL);
    }

    /// @param coll A collateral that has had refresh() called on it this timestamp
    /// @return {1} The multiplier to charge on issuance quantities for a collateral
    function issuancePremium(ICollateral coll) public view returns (uint192) {
        if (!enableIssuancePremium || coll.lastSave() != block.timestamp) return FIX_ONE;

        try coll.savedPegPrice() returns (uint192 pegPrice) {
            uint192 targetPerRef = coll.targetPerRef(); // {target/ref}
            if (pegPrice == 0 || pegPrice >= targetPerRef) return FIX_ONE;

            // {1} = {target/ref} / {target/ref}
            return targetPerRef.safeDiv(pegPrice, CEIL);
        } catch {
            // if savedPegPrice() does not exist on the collateral the error bytes are 0 len
            return FIX_ONE;
        }
    }

    /// Returns the quantity of collateral token in a BU
    /// @param erc20 The token contract
    /// @param coll The registered collateral plugin contract
    /// @return q {tok/BU} The token-quantity of an ERC20 token in the basket
    // Returns 0 if coll is not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function _quantity(
        IERC20 erc20,
        ICollateral coll,
        RoundingMode rounding
    ) internal view returns (uint192) {
        uint192 refPerTok = coll.refPerTok();
        if (refPerTok == 0) return FIX_MAX;

        // {tok/BU} = {ref/BU} / {ref/tok}
        return basket.refAmts[erc20].div(refPerTok, rounding);
    }

    /// Returns the price of a BU (including issuance premium)
    /// Included for backwards compatibility with <4.0.0
    /// Should not revert
    /// @return low {UoA/BU} The lower end of the price estimate
    /// @return high {UoA/BU} The upper end of the price estimate
    // returns sum(quantity(erc20) * price(erc20) for erc20 in basket.erc20s)
    function price() external view returns (uint192 low, uint192 high) {
        return price(true);
    }

    /// Should not revert
    /// @param applyIssuancePremium Whether to apply the issuance premium to the high price
    /// @return low {UoA/BU} The lower end of the price estimate
    /// @return high {UoA/BU} The upper end of the price estimate
    // returns sum(quantity(erc20) * price(erc20) for erc20 in basket.erc20s)
    function price(bool applyIssuancePremium) public view returns (uint192 low, uint192 high) {
        IAssetRegistry reg = main.assetRegistry();

        uint256 low256;
        uint256 high256;

        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            try main.assetRegistry().toColl(basket.erc20s[i]) returns (ICollateral coll) {
                uint192 qty = _quantity(basket.erc20s[i], coll, CEIL);
                if (qty == 0) continue;

                (uint192 lowP, uint192 highP) = reg.toAsset(basket.erc20s[i]).price();

                low256 += qty.safeMul(lowP, FLOOR);

                if (high256 < FIX_MAX) {
                    if (highP == FIX_MAX) {
                        high256 = FIX_MAX;
                        continue;
                    }

                    if (applyIssuancePremium) {
                        uint192 premium = issuancePremium(coll); // {1} always CEIL

                        // {tok} = {tok} * {1}
                        if (premium > FIX_ONE) qty = qty.safeMul(premium, CEIL);
                    }

                    high256 += qty.safeMul(highP, CEIL);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                continue;
            }
        }

        // safe downcast: FIX_MAX is type(uint192).max
        low = low256 >= FIX_MAX ? FIX_MAX : uint192(low256);
        high = high256 >= FIX_MAX ? FIX_MAX : uint192(high256);
    }

    /// Return the current issuance/redemption quantities for `amount` BUs
    /// Included for backwards compatibility with <4.0.0
    /// @param amount {BU}
    /// @param rounding If CEIL, apply issuance premium
    /// @return erc20s The backing collateral erc20s
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    // Returns (erc20s, [quantity(e) * amount {as qTok} for e in erc20s])
    function quote(uint192 amount, RoundingMode rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities)
    {
        return quote(amount, rounding == CEIL, rounding);
    }

    /// @param amount {BU}
    /// @param applyIssuancePremium Whether to apply the issuance premium
    /// @return erc20s The backing collateral erc20s
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    // Returns (erc20s, [quantity(e) * amount {as qTok} for e in erc20s])
    function quote(
        uint192 amount,
        bool applyIssuancePremium,
        RoundingMode rounding
    ) public view returns (address[] memory erc20s, uint256[] memory quantities) {
        IAssetRegistry assetRegistry = main.assetRegistry();
        erc20s = new address[](basket.erc20s.length);
        quantities = new uint256[](basket.erc20s.length);

        for (uint256 i = 0; i < basket.erc20s.length; ++i) {
            erc20s[i] = address(basket.erc20s[i]);
            ICollateral coll = assetRegistry.toColl(IERC20(erc20s[i]));

            // {tok} = {tok/BU} * {BU}
            uint192 q = _quantity(basket.erc20s[i], coll, rounding).safeMul(amount, rounding);

            // Prevent toxic issuance by charging more when collateral is under peg
            if (applyIssuancePremium) {
                uint192 premium = issuancePremium(coll); // {1} always CEIL

                // {tok} = {tok} * {1}
                if (premium > FIX_ONE) q = q.safeMul(premium, rounding);
            }

            // {qTok} = {tok} * {qTok/tok}
            quantities[i] = q.shiftl_toUint(
                int8(IERC20Metadata(address(basket.erc20s[i])).decimals()),
                rounding
            );
        }
    }

    /// Return the redemption value of `amount` BUs for a linear combination of historical baskets
    /// @param basketNonces An array of basket nonces to do redemption from
    /// @param portions {1} An array of Fix quantities
    /// @param amount {BU}
    /// @return erc20s The backing collateral erc20s
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    // Returns (erc20s, [quantity(e) * amount {as qTok} for e in erc20s])
    function quoteCustomRedemption(
        uint48[] memory basketNonces,
        uint192[] memory portions,
        uint192 amount
    ) external view returns (address[] memory erc20s, uint256[] memory quantities) {
        require(basketNonces.length == portions.length, "invalid lengths");

        IERC20[] memory erc20sAll = new IERC20[](main.assetRegistry().size());
        ICollateral[] memory collsAll = new ICollateral[](erc20sAll.length);
        uint192[] memory refAmtsAll = new uint192[](erc20sAll.length);

        uint256 len; // length of return arrays

        // Calculate the linear combination basket
        for (uint48 i = 0; i < basketNonces.length; ++i) {
            require(
                basketNonces[i] >= lastCollateralized && basketNonces[i] <= nonce,
                "invalid basketNonce"
            );
            Basket storage b = basketHistory[basketNonces[i]];

            // Add-in refAmts contribution from historical basket
            for (uint256 j = 0; j < b.erc20s.length; ++j) {
                if (address(b.erc20s[j]) == address(0)) continue;

                // Search through erc20sAll
                uint256 erc20Index = type(uint256).max;
                for (uint256 k = 0; k < len; ++k) {
                    if (b.erc20s[j] == erc20sAll[k]) {
                        erc20Index = k;
                        continue;
                    }
                }

                // Add new ERC20 entry if not found
                uint192 amt = portions[i].mul(b.refAmts[b.erc20s[j]], FLOOR);
                if (erc20Index == type(uint256).max) {
                    // New entry found

                    try main.assetRegistry().toAsset(b.erc20s[j]) returns (IAsset asset) {
                        if (!asset.isCollateral()) continue; // skip token if not collateral

                        erc20sAll[len] = b.erc20s[j];
                        collsAll[len] = ICollateral(address(asset));

                        // {ref} = {1} * {ref}
                        refAmtsAll[len] = amt;
                        ++len;
                    } catch (bytes memory errData) {
                        // untested:
                        //     OOG pattern tested in other contracts, cost to test here is high
                        // see: docs/solidity-style.md#Catching-Empty-Data
                        if (errData.length == 0) revert(); // solhint-disable-line reason-string
                        // skip token if no longer registered or other non-gas issue
                    }
                } else {
                    // {ref} = {1} * {ref}
                    refAmtsAll[erc20Index] += amt;
                }
            }
        }

        erc20s = new address[](len);
        quantities = new uint256[](len);

        // Calculate quantities
        for (uint256 i = 0; i < len; ++i) {
            erc20s[i] = address(erc20sAll[i]);

            // {tok} = {BU} * {ref/BU} / {ref/tok}
            quantities[i] = amount
            .safeMulDiv(refAmtsAll[i], collsAll[i].refPerTok(), FLOOR)
            .shiftl_toUint(int8(collsAll[i].erc20Decimals()), FLOOR);
        }
    }

    /// @return baskets {BU}
    ///          .top The number of partial basket units: e.g max(coll.map((c) => c.balAsBUs())
    ///          .bottom The number of whole basket units held by the account
    /// @dev Returns (FIX_ZERO, FIX_MAX) for an empty or DISABLED basket
    // Returns:
    //    (0, 0), if (basket.erc20s is empty) or (disabled is true) or (status() is DISABLED)
    //    min(e.balanceOf(account) / quantity(e) for e in basket.erc20s if quantity(e) > 0),
    function basketsHeldBy(address account) public view returns (BasketRange memory baskets) {
        if (basket.erc20s.length == 0 || disabled) return BasketRange(FIX_ZERO, FIX_MAX);
        baskets.bottom = FIX_MAX;

        for (uint256 i = 0; i < basket.erc20s.length; ++i) {
            ICollateral coll = main.assetRegistry().toColl(basket.erc20s[i]);
            if (coll.status() == CollateralStatus.DISABLED) return BasketRange(FIX_ZERO, FIX_MAX);

            // {tok/BU}
            uint192 q = _quantity(basket.erc20s[i], coll, CEIL);
            if (q == FIX_MAX) return BasketRange(FIX_ZERO, FIX_MAX);

            // {BU} = {tok} / {tok/BU}
            uint192 inBUs = coll.bal(account).div(q);
            baskets.bottom = fixMin(baskets.bottom, inBUs);
            baskets.top = fixMax(baskets.top, inBUs);
        }
    }

    // === Governance Setters ===

    /// @custom:governance
    function setWarmupPeriod(uint48 val) public governance {
        require(val >= MIN_WARMUP_PERIOD && val <= MAX_WARMUP_PERIOD, "invalid warmupPeriod");
        emit WarmupPeriodSet(warmupPeriod, val);
        warmupPeriod = val;
    }

    /// @custom:governance
    function setIssuancePremiumEnabled(bool val) public governance {
        emit EnableIssuancePremiumSet(enableIssuancePremium, val);
        enableIssuancePremium = val;
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
            nonce += 1;
            basket.setFrom(newBasket);
            basketHistory[nonce].setFrom(newBasket);
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
    function requireValidCollArray(IERC20[] calldata erc20s) private view {
        IERC20 zero = IERC20(address(0));

        for (uint256 i = 0; i < erc20s.length; i++) {
            require(erc20s[i] != main.rsr(), "invalid collateral");
            require(erc20s[i] != IERC20(address(main.rToken())), "invalid collateral");
            require(erc20s[i] != IERC20(address(main.stRSR())), "invalid collateral");
            require(erc20s[i] != zero, "invalid collateral");
        }

        require(ArrayLib.allUnique(erc20s), "contains duplicates");
    }

    /// Require that erc20s and targetAmts preserve the current config targets
    function requireConstantConfigTargets(IERC20[] calldata erc20s, uint192[] memory targetAmts)
        private
    {
        // Empty _targetAmts mapping
        while (_targetAmts.length() > 0) {
            (bytes32 key, ) = _targetAmts.at(0);
            _targetAmts.remove(key);
        }

        // Populate _targetAmts mapping with old basket config
        for (uint256 i = 0; i < config.erc20s.length; i++) {
            IERC20 erc20 = config.erc20s[i];
            bytes32 targetName = config.targetNames[erc20];
            uint192 targetAmt = config.targetAmts[erc20];
            (bool contains, uint256 amt) = _targetAmts.tryGet(targetName);
            _targetAmts.set(targetName, contains ? amt + targetAmt : targetAmt);
        }

        // Require new basket is exactly equal to old basket, in terms of targetAmts by targetName
        for (uint256 i = 0; i < erc20s.length; i++) {
            bytes32 targetName = main.assetRegistry().toColl(erc20s[i]).targetName();
            (bool contains, uint256 amt) = _targetAmts.tryGet(targetName);
            require(contains && amt >= targetAmts[i], "new target weights");
            if (amt == targetAmts[i]) _targetAmts.remove(targetName);
            else _targetAmts.set(targetName, amt - targetAmts[i]);
        }
        require(_targetAmts.length() == 0, "missing target weights");
    }

    /// Good collateral is registered, collateral, SOUND, has the expected targetName,
    /// and not a system token or 0 addr
    function goodCollateral(bytes32 targetName, IERC20 erc20) private view returns (bool) {
        if (erc20 == IERC20(address(0))) return false;
        if (erc20 == main.rsr()) return false;
        if (erc20 == IERC20(address(main.rToken()))) return false;
        if (erc20 == IERC20(address(main.stRSR()))) return false;

        try main.assetRegistry().toColl(erc20) returns (ICollateral coll) {
            return
                targetName == coll.targetName() &&
                coll.status() == CollateralStatus.SOUND &&
                coll.refPerTok() > 0 &&
                coll.targetPerRef() > 0;
        } catch {
            return false;
        }
    }
}
