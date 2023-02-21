// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

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
        require(bytes(name_).length > 0, "name empty");
        require(bytes(symbol_).length > 0, "symbol empty");
        require(bytes(mandate_).length > 0, "mandate empty");
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

    /// after fn(), assert exchangeRate in [MIN_EXCHANGE_RATE, MAX_EXCHANGE_RATE]
    modifier exchangeRateIsValidAfter() {
        _;
        uint256 supply = totalSupply();
        if (supply == 0) return;

        // Note: These are D18s, even though they are uint256s. This is because
        // we cannot assume we stay inside our valid range here, as that is what
        // we are checking in the first place
        uint256 low = (FIX_ONE_256 * basketsNeeded) / supply; // D18{BU/rTok}
        uint256 high = (FIX_ONE_256 * basketsNeeded + (supply - 1)) / supply; // D18{BU/rTok}

        // here we take advantage of an implicit upcast from uint192 exchange rates
        require(low >= MIN_EXCHANGE_RATE && high <= MAX_EXCHANGE_RATE, "BU rate out of range");
    }

    /// Issue an RToken with basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction nearly CEI, but see comments around handling of refunds
    function issue(uint256 amount) public {
        issueTo(_msgSender(), amount);
    }

    /// Issue an RToken with basket collateral, to a particular recipient
    /// @param recipient The address to receive the issued RTokens
    /// @param amount {qRTok} The quantity of RToken to issue
    /// @custom:interaction
    // untestable:
    //      `else` branch of `exchangeRateIsValidAfter` (ie. revert)
    //       BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    function issueTo(address recipient, uint256 amount)
        public
        notPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(amount > 0, "Cannot issue zero");

        // == Refresh ==
        assetRegistry.refresh();

        // == Checks-effects block ==
        address issuer = _msgSender(); // OK to save: it can't be changed in reentrant runs

        // Ensure SOUND basket
        require(basketHandler.status() == CollateralStatus.SOUND, "basket unsound");

        furnace.melt();
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
        uint192 amtBaskets = supply > 0
            ? basketsNeeded.muluDivu(amount, supply, CEIL)
            : _safeWrap(amount);
        emit Issuance(issuer, recipient, amount, amtBaskets);

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(
            amtBaskets,
            CEIL
        );

        // Fixlib optimization:
        // D18{BU} = D18{BU} + D18{BU}; uint192(+) is the same as Fix.plus
        uint192 newBasketsNeeded = basketsNeeded + amtBaskets;
        emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);
        basketsNeeded = newBasketsNeeded;

        // == Interactions: mint + transfer tokens to BackingManager ==
        _mint(recipient, amount);

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
    /// @param basketNonce The nonce of the basket the redemption should be from; else reverts
    /// @custom:interaction CEI
    function redeem(uint256 amount, uint48 basketNonce) external {
        redeemTo(_msgSender(), amount, basketNonce);
    }

    /// Redeem RToken for basket collateral to a particular recipient
    // checks:
    //   amount > 0
    //   amount <= balanceOf(caller)
    //   basket is not DISABLED
    //
    // effects:
    //   (so totalSupply -= amount and balanceOf(caller) -= amount)
    //   basketsNeeded' / totalSupply' >== basketsNeeded / totalSupply
    //
    // actions:
    //   let erc20s = basketHandler.erc20s()
    //   burn(caller, amount)
    //   for each token in erc20s:
    //     let tokenAmt = (amount * basketsNeeded / totalSupply) baskets of support for token
    //     let prorataAmt = (amount / totalSupply) * token.balanceOf(backingManager)
    //     do token.transferFrom(backingManager, caller, min(tokenAmt, prorataAmt))
    // untestable:
    //      `else` branch of `exchangeRateIsValidAfter` (ie. revert)
    //       BU exchange rate cannot decrease, and it can only increase when < FIX_ONE.
    /// @param recipient The address to receive the backing collateral tokens
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @param basketNonce The nonce of the basket the redemption should be from; else reverts
    /// @custom:interaction
    function redeemTo(
        address recipient,
        uint256 amount,
        uint48 basketNonce
    ) public notFrozen exchangeRateIsValidAfter {
        // == Refresh ==
        main.assetRegistry().refresh();

        // == Checks and Effects ==
        address redeemer = _msgSender();
        require(amount > 0, "Cannot redeem zero");
        require(amount <= balanceOf(redeemer), "insufficient balance");

        // Failure to melt results in a lower redemption price, so we can allow it when paused
        // solhint-disable-next-line no-empty-blocks
        try main.furnace().melt() {} catch {}
        uint256 supply = totalSupply();

        // Revert if redemption exceeds either supply throttle
        issuanceThrottle.useAvailable(supply, -int256(amount));
        redemptionThrottle.useAvailable(supply, int256(amount)); // reverts on over-redemption

        // ==== Get basket redemption ====
        // i.e, set (erc20s, amounts) = basketHandler.quote(amount * basketsNeeded / totalSupply)

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        // downcast is safe: amount < totalSupply and basketsNeeded < 1e57 < 2^190 (just barely)
        uint192 basketsRedeemed = basketsNeeded.muluDivu(amount, supply); // FLOOR
        emit Redemption(redeemer, recipient, amount, basketsRedeemed);

        require(basketHandler.nonce() == basketNonce, "non-current basket nonce");
        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quote(
            basketsRedeemed,
            FLOOR
        );

        // ==== Prorate redemption ====
        // i.e, set amounts = min(amounts, balances * amount / totalSupply)
        //   where balances[i] = erc20s[i].balanceOf(this)

        // Bound each withdrawal by the prorata share, in case we're currently under-collateralized
        uint256 erc20length = erc20s.length;
        for (uint256 i = 0; i < erc20length; ++i) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            uint256 prorata = mulDiv256(
                IERC20Upgradeable(erc20s[i]).balanceOf(address(backingManager)),
                amount,
                supply
            ); // FLOOR

            if (prorata < amounts[i]) amounts[i] = prorata;
        }

        uint192 newBasketsNeeded = basketsNeeded - basketsRedeemed;
        emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);
        basketsNeeded = newBasketsNeeded;

        // == Interactions ==
        // Accept and burn RToken, reverts if not enough balance to burn
        _burn(redeemer, amount);

        bool allZero = true;
        for (uint256 i = 0; i < erc20length; ++i) {
            if (amounts[i] == 0) continue;
            if (allZero) allZero = false;

            // Send withdrawal
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                address(backingManager),
                recipient,
                amounts[i]
            );
        }

        if (allZero) revert("empty redemption");
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amtRToken {qRTok} The amtRToken to be minted
    /// @custom:protected
    // checks: unpaused; unfrozen; caller is backingManager
    // effects:
    //   bal'[recipient] = bal[recipient] + amtRToken
    //   totalSupply' = totalSupply + amtRToken
    //
    // untestable:
    //   `else` branch of `exchangeRateIsValidAfter` (ie. revert) shows as uncovered
    //   but it is fully covered for `mint` (limitations of coverage plugin)
    function mint(address recipient, uint256 amtRToken)
        external
        notPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(_msgSender() == address(backingManager), "not backing manager");
        _mint(recipient, amtRToken);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    // checks: not paused or frozen
    // effects:
    //   bal'[caller] = bal[caller] - amtRToken
    //   totalSupply' = totalSupply - amtRToken
    //
    // untestable:
    //   `else` branch of `exchangeRateIsValidAfter` (ie. revert) shows as uncovered
    //   but it is fully covered for `melt` (limitations of coverage plugin)
    function melt(uint256 amtRToken) external exchangeRateIsValidAfter {
        require(_msgSender() == address(furnace), "furnace only");
        _burn(_msgSender(), amtRToken);
        require(totalSupply() >= FIX_ONE, "rToken supply too low to melt");
        emit Melted(amtRToken);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    // checks: unpaused; unfrozen; caller is backingManager
    // effects: basketsNeeded' = basketsNeeded_
    //
    // untestable:
    //   `else` branch of `exchangeRateIsValidAfter` (ie. revert) shows as uncovered
    //   but it is fully covered for `setBasketsNeeded` (limitations of coverage plugin)
    function setBasketsNeeded(uint192 basketsNeeded_)
        external
        notPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(_msgSender() == address(backingManager), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// Sends all token balance of erc20 (if it is registered) to the BackingManager
    /// @custom:interaction
    function monetizeDonations(IERC20 erc20) external notPausedOrFrozen {
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
        uint256 hourlyLimit = redemptionThrottle.hourlyLimit(supply);
        available = redemptionThrottle.currentlyAvailable(hourlyLimit);
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
        emit IssuanceThrottleSet(issuanceThrottle.params, params);
        issuanceThrottle.params = params;
    }

    /// @custom:governance
    function setRedemptionThrottleParams(ThrottleLib.Params calldata params) public governance {
        require(params.amtRate >= MIN_THROTTLE_RATE_AMT, "redemption amtRate too small");
        require(params.amtRate <= MAX_THROTTLE_RATE_AMT, "redemption amtRate too big");
        require(params.pctRate <= MAX_THROTTLE_PCT_AMT, "redemption pctRate too big");
        emit RedemptionThrottleSet(redemptionThrottle.params, params);
        redemptionThrottle.params = params;
    }

    // ==== Private ====

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
     */
    uint256[42] private __gap;
}
