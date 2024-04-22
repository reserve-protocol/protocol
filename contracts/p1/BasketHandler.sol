// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IBasketHandler.sol";
import "../interfaces/IMain.sol";
import "../libraries/Array.sol";
import "../libraries/Fixed.sol";
import "./mixins/BasketLib.sol";
import "./mixins/Component.sol";

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */

/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract BasketHandlerP1 is ComponentP1, IBasketHandler {
    using BasketLibP1 for Basket;
    using CollateralStatusComparator for CollateralStatus;
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for uint192;

    uint192 public constant MAX_TARGET_AMT = 1e3 * FIX_ONE; // {target/BU} max basket weight
    uint48 public constant MIN_WARMUP_PERIOD = 60; // {s} 1 minute
    uint48 public constant MAX_WARMUP_PERIOD = 60 * 60 * 24 * 365; // {s} 1 year
    uint256 internal constant MAX_BACKUP_ERC20S = 64;

    // Peer components
    IAssetRegistry private assetRegistry;
    IBackingManager private backingManager;
    IERC20 private rsr;
    IRToken private rToken;
    IStRSR private stRSR;

    // config is the basket configuration, from which basket will be computed in a basket-switch
    // event. config is only modified by governance through setPrimeBakset and setBackupConfig
    BasketConfig internal config;

    // basket, disabled, nonce, and timestamp are only ever set by `_switchBasket()`
    // basket is the current basket.
    Basket internal basket;

    uint48 public nonce; // {basketNonce} A unique identifier for this basket instance
    uint48 public timestamp; // The timestamp when this basket was last set

    // If disabled is true, status() is DISABLED, the basket is invalid,
    // and everything except redemption should be paused.
    bool internal disabled;

    // === Function-local transitory vars ===

    // These are effectively local variables of _switchBasket.
    // Nothing should use their values from previous transactions.
    EnumerableSet.Bytes32Set private _targetNames;
    Basket private _newBasket;

    // === Warmup Period ===
    // Added in 3.0.0

    // Warmup Period
    uint48 public warmupPeriod; // {s} how long to wait until issuance/trading after regaining SOUND

    // basket status changes, mainly set when `trackStatus()` is called
    // used to enforce warmup period, after regaining SOUND
    uint48 private lastStatusTimestamp;
    CollateralStatus private lastStatus;

    // === Historical basket nonces ===
    // Added in 3.0.0

    // A history of baskets by basket nonce; includes current basket
    mapping(uint48 => Basket) private basketHistory;

    // Effectively local variable of `BasketLibP1.requireConstantConfigTargets()`
    EnumerableMap.Bytes32ToUintMap private _targetAmts; // targetName -> {target/BU}

    // ===
    // Added in 3.2.0

    // Whether the total weights of the target basket can be changed
    bool public reweightable; // immutable after init

    uint48 public lastCollateralized; // {basketNonce} most recent full collateralization

    // ===

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
        bool reweightable_
    ) external initializer {
        __Component_init(main_);

        assetRegistry = main_.assetRegistry();
        backingManager = main_.backingManager();
        rsr = main_.rsr();
        rToken = main_.rToken();
        stRSR = main_.stRSR();

        setWarmupPeriod(warmupPeriod_);
        reweightable = reweightable_; // immutable thereafter

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
        require(_msgSender() == address(assetRegistry), "asset registry only");

        uint256 len = basket.erc20s.length;
        uint192[] memory refAmts = new uint192[](len);
        for (uint256 i = 0; i < len; ++i) refAmts[i] = basket.refAmts[basket.erc20s[i]];
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
        assetRegistry.refresh();

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
        // Historical context: This is not the ideal naming for this function but it allowed
        // reweightable RTokens introduced in 3.2.0 to be a minor update as opposed to major

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

    /// Set the prime basket
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    function setPrimeBasket(IERC20[] calldata erc20s, uint192[] calldata targetAmts) external {
        _setPrimeBasket(erc20s, targetAmts, true);
    }

    /// Set the prime basket without reweighting targetAmts by UoA of the current basket
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    function forceSetPrimeBasket(IERC20[] calldata erc20s, uint192[] calldata targetAmts) external {
        _setPrimeBasket(erc20s, targetAmts, false);
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @param normalize True iff targetAmts should be normalized by UoA to the reference basket
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
    //   config'.targetNames[e] = assetRegistry.toColl(e).targetName, for e in erc20s
    function _setPrimeBasket(
        IERC20[] calldata erc20s,
        uint192[] memory targetAmts,
        bool normalize
    ) internal {
        requireGovernanceOnly();
        require(erc20s.length != 0, "empty basket");
        require(erc20s.length == targetAmts.length, "len mismatch");
        requireValidCollArray(erc20s);

        if (!reweightable && config.erc20s.length != 0) {
            // Require targets remain constant
            BasketLibP1.requireConstantConfigTargets(
                assetRegistry,
                config,
                _targetAmts,
                erc20s,
                targetAmts
            );
        } else if (normalize && config.erc20s.length != 0) {
            // Confirm reference basket is SOUND
            assetRegistry.refresh(); // will set lastStatus
            require(lastStatus == CollateralStatus.SOUND, "unsound basket");

            // Normalize targetAmts based on UoA value of reference basket
            (uint192 low, uint192 high) = _price(false);
            assert(low != 0 && high != FIX_MAX); // implied by SOUND status
            targetAmts = BasketLibP1.normalizeByPrice(
                assetRegistry,
                erc20s,
                targetAmts,
                (low + high + 1) / 2
            );
        }

        // Clean up previous basket config
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            delete config.targetAmts[config.erc20s[i]];
            delete config.targetNames[config.erc20s[i]];
        }
        delete config.erc20s;

        // Set up new config basket
        bytes32[] memory names = new bytes32[](erc20s.length);

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the prime basket to have its asset unregistered.
            require(assetRegistry.toAsset(erc20s[i]).isCollateral(), "erc20 is not collateral");
            require(0 < targetAmts[i], "invalid target amount; must be nonzero");
            require(targetAmts[i] <= MAX_TARGET_AMT, "invalid target amount; too large");

            config.erc20s.push(erc20s[i]);
            config.targetAmts[erc20s[i]] = targetAmts[i];
            names[i] = assetRegistry.toColl(erc20s[i]).targetName();
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
    ) external {
        requireGovernanceOnly();
        require(max <= MAX_BACKUP_ERC20S, "max too large");
        require(erc20s.length <= MAX_BACKUP_ERC20S, "erc20s too large");
        requireValidCollArray(erc20s);
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;
        delete conf.erc20s;

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the backup config to have its asset altered.
            require(assetRegistry.toAsset(erc20s[i]).isCollateral(), "erc20 is not collateral");
            conf.erc20s.push(erc20s[i]);
        }
        emit BackupConfigSet(targetName, max, erc20s);
    }

    /// @return Whether this contract owns enough collateral to cover rToken.basketsNeeded() BUs
    /// ie, whether the protocol is currently fully collateralized
    function fullyCollateralized() public view returns (bool) {
        BasketRange memory held = basketsHeldBy(address(backingManager));
        return held.bottom >= rToken.basketsNeeded();
    }

    /// @return status_ The status of the basket
    // returns DISABLED if disabled == true, and worst(status(coll)) otherwise
    function status() public view returns (CollateralStatus status_) {
        uint256 size = basket.erc20s.length;

        // untestable:
        //      disabled is only set in _switchBasket, and only if size > 0.
        if (disabled || size == 0) return CollateralStatus.DISABLED;

        for (uint256 i = 0; i < size; ++i) {
            CollateralStatus s = assetRegistry.toColl(basket.erc20s[i]).status();
            if (s.worseThan(status_)) {
                if (s == CollateralStatus.DISABLED) return CollateralStatus.DISABLED;
                status_ = s;
            }
        }
    }

    /// @return Whether the basket is ready to issue and trade
    function isReady() external view returns (bool) {
        return
            status() == CollateralStatus.SOUND &&
            (block.timestamp >= lastStatusTimestamp + warmupPeriod);
    }

    /// @param erc20 The token contract to check for quantity for
    /// @return {tok/BU} The token-quantity of an ERC20 token in the basket.
    // Returns 0 if erc20 is not registered or not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function quantity(IERC20 erc20) public view returns (uint192) {
        try assetRegistry.toColl(erc20) returns (ICollateral coll) {
            return _quantity(erc20, coll);
        } catch {
            return FIX_ZERO;
        }
    }

    /// Like quantity(), but unsafe because it DOES NOT CONFIRM THAT THE ASSET IS CORRECT
    /// @param erc20 The ERC20 token contract for the asset
    /// @param asset The registered asset plugin contract for the erc20
    /// @return {tok/BU} The token-quantity of an ERC20 token in the basket.
    // Returns 0 if erc20 is not registered or not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function quantityUnsafe(IERC20 erc20, IAsset asset) public view returns (uint192) {
        if (!asset.isCollateral()) return FIX_ZERO;
        return _quantity(erc20, ICollateral(address(asset)));
    }

    /// @param erc20 The token contract
    /// @param coll The registered collateral plugin contract
    /// @return {tok/BU} The token-quantity of an ERC20 token in the basket.
    // Returns 0 if coll is not in the basket
    // Returns FIX_MAX (in lieu of +infinity) if Collateral.refPerTok() is 0.
    // Otherwise returns (token's basket.refAmts / token's Collateral.refPerTok())
    function _quantity(IERC20 erc20, ICollateral coll) internal view returns (uint192) {
        uint192 refPerTok = coll.refPerTok();
        if (refPerTok == 0) return FIX_MAX;

        // {tok/BU} = {ref/BU} / {ref/tok}
        return basket.refAmts[erc20].div(refPerTok, CEIL);
    }

    /// Should not revert
    /// @return low {UoA/BU} The lower end of the price estimate
    /// @return high {UoA/BU} The upper end of the price estimate
    // returns sum(quantity(erc20) * price(erc20) for erc20 in basket.erc20s)
    function price() external view returns (uint192 low, uint192 high) {
        return _price(false);
    }

    /// Should not revert
    /// lowLow should be nonzero when the asset might be worth selling
    /// @dev Deprecated. Phased out in 3.1.0, but left on interface for backwards compatibility
    /// @return lotLow {UoA/BU} The lower end of the lot price estimate
    /// @return lotHigh {UoA/BU} The upper end of the lot price estimate
    // returns sum(quantity(erc20) * lotPrice(erc20) for erc20 in basket.erc20s)
    function lotPrice() external view returns (uint192 lotLow, uint192 lotHigh) {
        return _price(true);
    }

    /// Returns the price of a BU, using the lot prices if `useLotPrice` is true
    /// @param useLotPrice Whether to use lotPrice() or price()
    /// @return low {UoA/BU} The lower end of the price estimate
    /// @return high {UoA/BU} The upper end of the price estimate
    function _price(bool useLotPrice) internal view returns (uint192 low, uint192 high) {
        uint256 low256;
        uint256 high256;

        uint256 len = basket.erc20s.length;
        for (uint256 i = 0; i < len; ++i) {
            uint192 qty = quantity(basket.erc20s[i]);
            if (qty == 0) continue;

            (uint192 lowP, uint192 highP) = useLotPrice
                ? assetRegistry.toAsset(basket.erc20s[i]).lotPrice()
                : assetRegistry.toAsset(basket.erc20s[i]).price();

            low256 += qty.safeMul(lowP, RoundingMode.FLOOR);

            if (high256 < FIX_MAX) {
                if (highP == FIX_MAX) {
                    high256 = FIX_MAX;
                } else {
                    high256 += qty.safeMul(highP, RoundingMode.CEIL);
                }
            }
        }

        // safe downcast: FIX_MAX is type(uint192).max
        low = low256 >= FIX_MAX ? FIX_MAX : uint192(low256);
        high = high256 >= FIX_MAX ? FIX_MAX : uint192(high256);
    }

    /// Return the current issuance/redemption value of `amount` BUs
    /// Any approvals needed to issue RTokens should be set to the values returned by this function
    /// @dev Subset of logic of quoteCustomRedemption; more gas efficient for current nonce
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
            ICollateral coll = assetRegistry.toColl(IERC20(erc20s[i]));

            // {qTok} = {tok/BU} * {BU} * {tok} * {qTok/tok}
            quantities[i] = _quantity(basket.erc20s[i], coll)
            .safeMul(amount, rounding)
            .shiftl_toUint(int8(IERC20Metadata(address(basket.erc20s[i])).decimals()), rounding);
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
        require(basketNonces.length == portions.length, "bad portions len");

        IERC20[] memory erc20sAll = new IERC20[](assetRegistry.size());
        ICollateral[] memory collsAll = new ICollateral[](erc20sAll.length);
        uint192[] memory refAmtsAll = new uint192[](erc20sAll.length);

        uint256 len; // length of return arrays

        // Calculate the linear combination basket
        for (uint48 i = 0; i < basketNonces.length; ++i) {
            require(
                basketNonces[i] >= lastCollateralized && basketNonces[i] <= nonce,
                "invalid basketNonce"
            );
            // Known limitation: During an ongoing rebalance it may possible to redeem
            // on a previous basket nonce for _more_ UoA value than the current basket.
            // This can only occur for index RTokens, and the risk has been mitigated
            // by updating `lastCollateralized` on every assetRegistry.refresh().

            // Add-in refAmts contribution from historical basket
            Basket storage b = basketHistory[basketNonces[i]];
            for (uint256 j = 0; j < b.erc20s.length; ++j) {
                // untestable:
                //     previous baskets erc20s do not contain the zero address
                if (address(b.erc20s[j]) == address(0)) continue;

                // Search through erc20sAll
                uint256 erc20Index = type(uint256).max;
                for (uint256 k = 0; k < len; ++k) {
                    if (b.erc20s[j] == erc20sAll[k]) {
                        erc20Index = k;
                        break;
                    }
                }

                // Add new ERC20 entry if not found
                uint192 amt = portions[i].mul(b.refAmts[b.erc20s[j]], FLOOR);
                if (erc20Index == type(uint256).max) {
                    // New entry found

                    try assetRegistry.toAsset(b.erc20s[j]) returns (IAsset asset) {
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
            // marginally more penalizing than its sibling calculation that uses _quantity()
            // because does not intermediately CEIL as part of the division
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
        uint256 length = basket.erc20s.length;
        if (length == 0 || disabled) return BasketRange(FIX_ZERO, FIX_MAX);
        baskets.bottom = FIX_MAX;

        for (uint256 i = 0; i < length; ++i) {
            ICollateral coll = assetRegistry.toColl(basket.erc20s[i]);
            if (coll.status() == CollateralStatus.DISABLED) return BasketRange(FIX_ZERO, FIX_MAX);

            uint192 refPerTok = coll.refPerTok();
            // If refPerTok is 0, then we have zero of coll's reference unit.
            // We know that basket.refAmts[basket.erc20s[i]] > 0, so we have no baskets.
            if (refPerTok == 0) return BasketRange(FIX_ZERO, FIX_MAX);

            // {tok/BU} = {ref/BU} / {ref/tok}.  0-division averted by condition above.
            uint192 q = basket.refAmts[basket.erc20s[i]].div(refPerTok, CEIL);
            // q > 0 because q = (n).div(_, CEIL) and n > 0
            // {BU} = {tok} / {tok/BU}
            uint192 inBUs = coll.bal(account).div(q);
            baskets.bottom = fixMin(baskets.bottom, inBUs);
            baskets.top = fixMax(baskets.top, inBUs);
        }
    }

    // === Governance Setters ===

    /// @custom:governance
    function setWarmupPeriod(uint48 val) public {
        requireGovernanceOnly();
        require(val >= MIN_WARMUP_PERIOD && val <= MAX_WARMUP_PERIOD, "invalid warmupPeriod");
        emit WarmupPeriodSet(warmupPeriod, val);
        warmupPeriod = val;
    }

    // === Private ===

    // contract-size-saver
    // solhint-disable-next-line no-empty-blocks
    function requireGovernanceOnly() private governance {}

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    function _switchBasket() private {
        // Mark basket disabled. Pause most protocol functions unless there is a next basket
        disabled = true;

        bool success = _newBasket.nextBasket(_targetNames, config, assetRegistry);
        // if success is true: _newBasket is the next basket

        if (success) {
            // nonce' = nonce + 1
            // basket' = _newBasket
            // timestamp' = now

            nonce += 1;
            basket.setFrom(_newBasket);
            basketHistory[nonce].setFrom(_newBasket);
            timestamp = uint48(block.timestamp);
            disabled = false;
        }

        // Keep records, emit event
        uint256 len = basket.erc20s.length;
        uint192[] memory refAmts = new uint192[](len);
        for (uint256 i = 0; i < len; ++i) {
            refAmts[i] = basket.refAmts[basket.erc20s[i]];
        }
        emit BasketSet(nonce, basket.erc20s, refAmts, disabled);
    }

    /// Require that erc20s is a valid collateral array
    function requireValidCollArray(IERC20[] calldata erc20s) private view {
        for (uint256 i = 0; i < erc20s.length; ++i) {
            require(
                erc20s[i] != rsr &&
                    erc20s[i] != IERC20(address(rToken)) &&
                    erc20s[i] != IERC20(address(stRSR)) &&
                    erc20s[i] != IERC20(address(0)),
                "invalid collateral"
            );
        }

        require(ArrayLib.allUnique(erc20s), "contains duplicates");
    }

    // ==== ReadFacet views ====
    // Not used in-protocol; helpful for reconstructing state

    /// Get a reference basket in today's collateral tokens, by nonce
    /// @param basketNonce {basketNonce}
    /// @return erc20s The erc20s in the reference basket
    /// @return quantities {qTok/BU} The quantity of whole tokens per whole basket unit
    function getHistoricalBasket(uint48 basketNonce)
        external
        view
        returns (IERC20[] memory erc20s, uint256[] memory quantities)
    {
        Basket storage b = basketHistory[basketNonce];
        erc20s = new IERC20[](b.erc20s.length);
        quantities = new uint256[](erc20s.length);

        for (uint256 i = 0; i < b.erc20s.length; ++i) {
            erc20s[i] = b.erc20s[i];

            try assetRegistry.toAsset(IERC20(erc20s[i])) returns (IAsset asset) {
                if (!asset.isCollateral()) continue; // skip token if no longer registered

                // {tok} = {BU} * {ref/BU} / {ref/tok}
                quantities[i] = b
                .refAmts[erc20s[i]]
                .safeDiv(ICollateral(address(asset)).refPerTok(), FLOOR)
                .shiftl_toUint(int8(asset.erc20Decimals()), FLOOR);
            } catch (bytes memory errData) {
                // untested:
                //     OOG pattern tested in other contracts, cost to test here is high
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
            }
        }
    }

    /// Getter part1 for `config` struct variable
    /// @dev Indices are shared across return values
    /// @return erc20s The erc20s in the prime basket
    /// @return targetNames The bytes32 name identifier of the target unit, per ERC20
    /// @return targetAmts {target/BU} The amount of the target unit in the basket, per ERC20
    function getPrimeBasket()
        external
        view
        returns (
            IERC20[] memory erc20s,
            bytes32[] memory targetNames,
            uint192[] memory targetAmts
        )
    {
        erc20s = new IERC20[](config.erc20s.length);
        targetNames = new bytes32[](erc20s.length);
        targetAmts = new uint192[](erc20s.length);

        for (uint256 i = 0; i < erc20s.length; ++i) {
            erc20s[i] = config.erc20s[i];
            targetNames[i] = config.targetNames[erc20s[i]];
            targetAmts[i] = config.targetAmts[erc20s[i]];
        }
    }

    /// Getter part2 for `config` struct variable
    /// @param targetName The name of the target unit to lookup the backup for
    /// @return erc20s The backup erc20s for the target unit, in order of most to least desirable
    /// @return max The maximum number of tokens from the array to use at a single time
    function getBackupConfig(bytes32 targetName)
        external
        view
        returns (IERC20[] memory erc20s, uint256 max)
    {
        BackupConfig storage backup = config.backups[targetName];
        erc20s = new IERC20[](backup.erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            erc20s[i] = backup.erc20s[i];
        }
        max = backup.max;
    }

    // ==== Storage Gap ====

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     *
     * BasketHandler uses 58 slots, not 50.
     */
    uint256[36] private __gap;
}
