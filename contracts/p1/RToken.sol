// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../libraries/Throttle.sol";
import "../vendor/ERC20PermitUpgradeable.sol";
import "./mixins/Component.sol";

/**
 * @title RTokenP1
 * An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP1 is ComponentP1, ERC20PermitUpgradeable, IRToken {
    using FixLib for uint192;
    using ThrottleLib for ThrottleLib.Throttle;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public constant MIN_THROTTLE_RATE_AMT = 1e18; // {qRTok}
    uint256 public constant MAX_THROTTLE_RATE_AMT = 1e48; // {qRTok}
    uint192 public constant MAX_THROTTLE_PCT_AMT = 1e18; // {qRTok}
    uint192 public constant MIN_EXCHANGE_RATE = 1e9; // D18{BU/rTok}
    uint192 public constant MAX_EXCHANGE_RATE = 1e27; // D18{BU/rTok}

    /// The mandate describes what goals its governors should try to achieve. By succinctly
    /// explaining the RToken’s purpose and what the RToken is intended to do, it provides common
    /// ground for the governors to decide upon priorities and how to weigh tradeoffs.
    ///
    /// Example Mandates:
    ///
    /// - Capital preservation first. Spending power preservation second. Permissionless
    ///     access third.
    /// - Capital preservation above all else. All revenues fund the over-collateralization pool.
    /// - Risk-neutral pursuit of profit for token holders.
    ///     Maximize (gross revenue - payments for over-collateralization and governance).
    /// - This RToken holds only FooCoin, to provide a trade for hedging against its
    ///     possible collapse.
    ///
    /// The mandate may also be a URI to a longer body of text, presumably on IPFS or some other
    /// immutable data store.
    string public mandate;

    // ==== Peer components ====
    IAssetRegistry private assetRegistry;
    IBasketHandler private basketHandler;
    IBackingManager private backingManager;
    IFurnace private furnace;

    // The number of baskets that backingManager must hold
    // in order for this RToken to be fully collateralized.
    // The exchange rate for issuance and redemption is totalSupply()/basketsNeeded {BU}/{qRTok}.
    uint192 public basketsNeeded; // D18{BU}

    // === Supply throttles ===
    ThrottleLib.Throttle private issuanceThrottle;
    ThrottleLib.Throttle private redemptionThrottle;

    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        string calldata mandate_,
        ThrottleLib.Params calldata issuanceThrottleParams_,
        ThrottleLib.Params calldata redemptionThrottleParams_
    ) external initializer {
        require(bytes(name_).length != 0, "name empty");
        require(bytes(symbol_).length != 0, "symbol empty");
        require(bytes(mandate_).length != 0, "mandate empty");
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);

        assetRegistry = main_.assetRegistry();
        basketHandler = main_.basketHandler();
        backingManager = main_.backingManager();
        furnace = main_.furnace();

        mandate = mandate_;
        setIssuanceThrottleParams(issuanceThrottleParams_);
        setRedemptionThrottleParams(redemptionThrottleParams_);

        issuanceThrottle.lastTimestamp = uint48(block.timestamp);
        redemptionThrottle.lastTimestamp = uint48(block.timestamp);
    }

    /// Issue an RToken on the current basket
    /// Do no use inifite approvals.  Instead, use BasketHandler.quote() to determine the amount
    ///     of backing tokens to approve.
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction nearly CEI, but see comments around handling of refunds
    function issue(uint256 amount) public {
        issueTo(_msgSender(), amount);
    }

    /// Issue an RToken on the current basket, to a particular recipient
    /// Do no use inifite approvals.  Instead, use BasketHandler.quote() to determine the amount
    ///     of backing tokens to approve.
    /// @param recipient The address to receive the issued RTokens
    /// @param amount {qRTok} The quantity of RToken to issue
    /// @custom:interaction RCEI
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    function issueTo(address recipient, uint256 amount) public notIssuancePausedOrFrozen {
        require(amount != 0, "Cannot issue zero");

        // == Refresh ==

        assetRegistry.refresh();

        // == Checks-effects block ==

        address issuer = _msgSender(); // OK to save: it can't be changed in reentrant runs

        // Ensure basket is ready, SOUND and not in warmup period
        require(basketHandler.isReady(), "basket not ready");
        uint256 supply = totalSupply();

        // Revert if issuance exceeds either supply throttle
        issuanceThrottle.useAvailable(supply, int256(amount)); // reverts on over-issuance
        redemptionThrottle.useAvailable(supply, -int256(amount)); // shouldn't revert

        // AT THIS POINT:
        //   all contract invariants hold
        //   furnace melting is up-to-date
        //   asset states are up-to-date
        //   throttle is up-to-date

        // amtBaskets: the BU change to be recorded by this issuance
        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        // revert-on-overflow provided by FixLib functions
        uint192 amtBaskets = supply != 0
            ? basketsNeeded.muluDivu(amount, supply, CEIL)
            : _safeWrap(amount);
        emit Issuance(issuer, recipient, amount, amtBaskets);

        // Get quote from BasketHandler including issuance premium
        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(
            amtBaskets,
            true,
            CEIL
        );

        // == Interactions: Create RToken + transfer tokens to BackingManager ==
        _scaleUp(recipient, amtBaskets, supply);

        for (uint256 i = 0; i < erc20s.length; ++i) {
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                issuer,
                address(backingManager),
                deposits[i]
            );
        }
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction CEI
    function redeem(uint256 amount) external {
        redeemTo(_msgSender(), amount);
    }

    /// Redeem RToken for basket collateral to a particular recipient
    // checks:
    //   amount > 0
    //   amount <= balanceOf(caller)
    //
    // effects:
    //   (so totalSupply -= amount and balanceOf(caller) -= amount)
    //   basketsNeeded' / totalSupply' >== basketsNeeded / totalSupply
    //   burn(caller, amount)
    //
    // actions:
    //   let erc20s = basketHandler.erc20s()
    //   for each token in erc20s:
    //     let tokenAmt = (amount * basketsNeeded / totalSupply) current baskets
    //     do token.transferFrom(backingManager, caller, tokenAmt)
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    /// @param recipient The address to receive the backing collateral tokens
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction RCEI
    function redeemTo(address recipient, uint256 amount) public notFrozen {
        // == Refresh ==
        assetRegistry.refresh();

        // == Checks and Effects ==

        address caller = _msgSender();

        require(amount != 0, "Cannot redeem zero");
        require(amount <= balanceOf(caller), "insufficient balance");
        require(basketHandler.fullyCollateralized(), "partial redemption; use redeemCustom");
        // redemption while IFFY/DISABLED allowed

        uint256 supply = totalSupply();

        // Revert if redemption exceeds either supply throttle
        issuanceThrottle.useAvailable(supply, -int256(amount));
        redemptionThrottle.useAvailable(supply, int256(amount)); // reverts on over-redemption

        // {BU}
        uint192 baskets = _scaleDown(caller, amount);
        emit Redemption(caller, recipient, amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quote(
            baskets,
            false,
            FLOOR
        );

        // === Interactions ===

        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (amounts[i] == 0) continue;

            // Send withdrawal
            // slither-disable-next-line arbitrary-send-erc20
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                address(backingManager),
                recipient,
                amounts[i]
            );
        }
    }

    /// Redeem RToken for a linear combination of historical baskets, to a particular recipient
    // checks:
    //   amount > 0
    //   amount <= balanceOf(caller)
    //   sum(portions) == FIX_ONE
    //   nonce >= basketHandler.primeNonce() for nonce in basketNonces
    //
    // effects:
    //   (so totalSupply -= amount and balanceOf(caller) -= amount)
    //   basketsNeeded' / totalSupply' >== basketsNeeded / totalSupply
    //   burn(caller, amount)
    //
    // actions:
    //   for each token in erc20s:
    //     let tokenAmt = (amount * basketsNeeded / totalSupply) custom baskets
    //     let prorataAmt = (amount / totalSupply) * token.balanceOf(backingManager)
    //     do token.transferFrom(backingManager, caller, min(tokenAmt, prorataAmt))
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    /// @dev Allows partial redemptions up to the minAmounts
    /// @param recipient The address to receive the backing collateral tokens
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @param basketNonces An array of basket nonces to do redemption from
    /// @param portions {1} An array of Fix quantities that must add up to FIX_ONE
    /// @param expectedERC20sOut An array of ERC20s expected out
    /// @param minAmounts {qTok} The minimum ERC20 quantities the caller should receive
    /// @custom:interaction RCEI
    function redeemCustom(
        address recipient,
        uint256 amount,
        uint48[] memory basketNonces,
        uint192[] memory portions,
        address[] memory expectedERC20sOut,
        uint256[] memory minAmounts
    ) external notFrozen {
        // == Refresh ==
        assetRegistry.refresh();

        // == Checks and Effects ==

        require(amount != 0, "Cannot redeem zero");
        require(amount <= balanceOf(_msgSender()), "insufficient balance");
        uint256 portionsSum;
        for (uint256 i = 0; i < portions.length; ++i) {
            portionsSum += portions[i];
        }
        require(portionsSum == FIX_ONE, "portions do not add up to FIX_ONE");

        uint256 supply = totalSupply();

        // Revert if redemption exceeds either supply throttle
        issuanceThrottle.useAvailable(supply, -int256(amount));
        redemptionThrottle.useAvailable(supply, int256(amount)); // reverts on over-redemption

        // {BU}
        uint192 baskets = _scaleDown(_msgSender(), amount);
        emit Redemption(_msgSender(), recipient, amount, baskets);

        // === Get basket redemption amounts ===

        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quoteCustomRedemption(
            basketNonces,
            portions,
            baskets
        );

        // ==== Prorate redemption ====
        // i.e, set amounts = min(amounts, balances * amount / totalSupply)
        //   where balances[i] = erc20s[i].balanceOf(backingManager)

        // Bound each withdrawal by the prorata share, in case we're currently under-collateralized
        for (uint256 i = 0; i < erc20s.length; ++i) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            uint256 prorata = mulDiv256(
                IERC20(erc20s[i]).balanceOf(address(backingManager)),
                amount,
                supply
            ); // FLOOR

            if (prorata < amounts[i]) amounts[i] = prorata;
        }

        // === Save initial recipient balances ===

        uint256[] memory pastBals = new uint256[](expectedERC20sOut.length);
        for (uint256 i = 0; i < expectedERC20sOut.length; ++i) {
            pastBals[i] = IERC20(expectedERC20sOut[i]).balanceOf(recipient);
            // we haven't verified this ERC20 is registered but this is always a staticcall
        }

        // === Interactions ===

        // Distribute tokens; revert if empty redemption
        {
            bool allZero = true;
            for (uint256 i = 0; i < erc20s.length; ++i) {
                if (amounts[i] == 0) continue; // unregistered ERC20s will have 0 amount
                if (allZero) allZero = false;

                // Send withdrawal
                // slither-disable-next-line arbitrary-send-erc20
                IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                    address(backingManager),
                    recipient,
                    amounts[i]
                );
            }
            if (allZero) revert("empty redemption");
        }

        // === Post-checks ===

        // Check post-balances
        for (uint256 i = 0; i < expectedERC20sOut.length; ++i) {
            uint256 bal = IERC20(expectedERC20sOut[i]).balanceOf(recipient);
            // we haven't verified this ERC20 is registered but this is always a staticcall
            require(bal - pastBals[i] >= minAmounts[i], "redemption below minimum");
        }
    }

    /// Mint an amount of RToken equivalent to baskets BUs, scaling basketsNeeded up
    /// Callable only by BackingManager
    /// @param baskets {BU} The number of baskets to mint RToken for
    /// @custom:protected
    // checks: caller is backingManager
    // effects:
    //   bal'[recipient] = bal[recipient] + amtRToken
    //   totalSupply' = totalSupply + amtRToken
    //   basketsNeeded' = basketsNeeded + baskets
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    function mint(uint192 baskets) external {
        require(_msgSender() == address(backingManager), "not backing manager");
        _scaleUp(address(backingManager), baskets, totalSupply());
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    /// @custom:protected
    // checks: caller is furnace
    // effects:
    //   bal'[caller] = bal[caller] - amtRToken
    //   totalSupply' = totalSupply - amtRToken
    // BU exchange rate cannot decrease
    // BU exchange rate CAN increase, but we already trust furnace to do this slowly
    function melt(uint256 amtRToken) external {
        address caller = _msgSender();
        require(caller == address(furnace), "furnace only");
        _burn(caller, amtRToken);
        emit Melted(amtRToken);
    }

    /// Burn an amount of RToken from caller's account and scale basketsNeeded down
    /// Callable only by backingManager
    /// @param amount {qRTok}
    /// @custom:protected
    // checks: caller is backingManager
    // effects:
    //   bal'[recipient] = bal[recipient] - amtRToken
    //   totalSupply' = totalSupply - amtRToken
    //   basketsNeeded' = basketsNeeded - baskets
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    function dissolve(uint256 amount) external {
        address caller = _msgSender();
        require(caller == address(backingManager), "not backing manager");
        _scaleDown(caller, amount);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    // checks: caller is backingManager
    // effects: basketsNeeded' = basketsNeeded_
    function setBasketsNeeded(uint192 basketsNeeded_) external notTradingPausedOrFrozen {
        require(_msgSender() == address(backingManager), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;

        // == P0 exchangeRateIsValidAfter modifier ==
        uint256 supply = totalSupply();
        require(supply != 0, "0 supply");

        // Note: These are D18s, even though they are uint256s. This is because
        // we cannot assume we stay inside our valid range here, as that is what
        // we are checking in the first place
        uint256 low = (FIX_ONE_256 * basketsNeeded_) / supply; // D18{BU/rTok}
        uint256 high = (FIX_ONE_256 * basketsNeeded_ + (supply - 1)) / supply; // D18{BU/rTok}

        // here we take advantage of an implicit upcast from uint192 exchange rates
        require(low >= MIN_EXCHANGE_RATE && high <= MAX_EXCHANGE_RATE, "BU rate out of range");
    }

    /// Sends all token balance of erc20 (if it is registered) to the BackingManager
    /// @custom:interaction
    function monetizeDonations(IERC20 erc20) external notTradingPausedOrFrozen {
        require(assetRegistry.isRegistered(erc20), "erc20 unregistered");
        IERC20Upgradeable(address(erc20)).safeTransfer(
            address(backingManager),
            erc20.balanceOf(address(this))
        );
    }

    // ==== Throttle setters/getters ====

    /// @return {qRTok} The maximum issuance that can be performed in the current block
    function issuanceAvailable() external view returns (uint256) {
        return issuanceThrottle.currentlyAvailable(issuanceThrottle.hourlyLimit(totalSupply()));
    }

    /// @return available {qRTok} The maximum redemption that can be performed in the current block
    function redemptionAvailable() external view returns (uint256 available) {
        uint256 supply = totalSupply();
        available = redemptionThrottle.currentlyAvailable(redemptionThrottle.hourlyLimit(supply));
        if (supply < available) available = supply;
    }

    /// @return The issuance throttle parametrization
    function issuanceThrottleParams() external view returns (ThrottleLib.Params memory) {
        return issuanceThrottle.params;
    }

    /// @return The redemption throttle parametrization
    function redemptionThrottleParams() external view returns (ThrottleLib.Params memory) {
        return redemptionThrottle.params;
    }

    /// @custom:governance
    function setIssuanceThrottleParams(ThrottleLib.Params calldata params) public governance {
        require(params.amtRate >= MIN_THROTTLE_RATE_AMT, "issuance amtRate too small");
        require(params.amtRate <= MAX_THROTTLE_RATE_AMT, "issuance amtRate too big");
        require(params.pctRate <= MAX_THROTTLE_PCT_AMT, "issuance pctRate too big");
        issuanceThrottle.useAvailable(totalSupply(), 0);

        emit IssuanceThrottleSet(issuanceThrottle.params, params);
        issuanceThrottle.params = params;
    }

    /// @custom:governance
    function setRedemptionThrottleParams(ThrottleLib.Params calldata params) public governance {
        require(params.amtRate >= MIN_THROTTLE_RATE_AMT, "redemption amtRate too small");
        require(params.amtRate <= MAX_THROTTLE_RATE_AMT, "redemption amtRate too big");
        require(params.pctRate <= MAX_THROTTLE_PCT_AMT, "redemption pctRate too big");
        redemptionThrottle.useAvailable(totalSupply(), 0);

        emit RedemptionThrottleSet(redemptionThrottle.params, params);
        redemptionThrottle.params = params;
    }

    // ==== Private ====

    /// Mint an amount of RToken equivalent to amtBaskets and scale basketsNeeded up
    /// @param recipient The address to receive the RTokens
    /// @param amtBaskets {BU} The number of amtBaskets to mint RToken for
    /// @param totalSupply {qRTok} The current totalSupply
    // effects:
    //   bal'[recipient] = bal[recipient] + amtRToken
    //   totalSupply' = totalSupply + amtRToken
    //   basketsNeeded' = basketsNeeded + amtBaskets
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    function _scaleUp(
        address recipient,
        uint192 amtBaskets,
        uint256 totalSupply
    ) private {
        // take advantage of 18 decimals during casting
        uint256 amtRToken = totalSupply != 0
            ? amtBaskets.muluDivu(totalSupply, basketsNeeded) // {rTok} = {BU} * {qRTok} * {qRTok}
            : amtBaskets; // {rTok}
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded + amtBaskets);
        basketsNeeded += amtBaskets;

        // Mint RToken to recipient
        _mint(recipient, amtRToken);
    }

    /// Burn an amount of RToken and scale basketsNeeded down
    /// @param account The address to dissolve RTokens from
    /// @param amtRToken {qRTok} The amount of RToken to be dissolved
    /// @return amtBaskets {BU} The equivalent number of baskets dissolved
    // effects:
    //   bal'[recipient] = bal[recipient] - amtRToken
    //   totalSupply' = totalSupply - amtRToken
    //   basketsNeeded' = basketsNeeded - amtBaskets
    // BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    function _scaleDown(address account, uint256 amtRToken) private returns (uint192 amtBaskets) {
        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        amtBaskets = basketsNeeded.muluDivu(amtRToken, totalSupply()); // FLOOR
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded - amtBaskets);
        basketsNeeded -= amtBaskets;

        // Burn RToken from account; reverts if not enough balance
        _burn(account, amtRToken);
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     */
    function _beforeTokenTransfer(
        address,
        address to,
        uint256
    ) internal virtual override {
        require(to != address(this), "RToken transfer to self");
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     *
     * RToken uses 56 slots, not 50.
     */
    uint256[42] private __gap;
}
