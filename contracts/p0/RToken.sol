// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IBasketHandler.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../libraries/Throttle.sol";
import "../vendor/ERC20PermitUpgradeable.sol";
import "./mixins/Component.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP0 is ComponentP0, ERC20PermitUpgradeable, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for uint192;
    using ThrottleLib for ThrottleLib.Throttle;
    using SafeERC20 for IERC20;

    uint256 public constant MIN_THROTTLE_RATE_AMT = 1e18; // {qRTok}
    uint256 public constant MAX_THROTTLE_RATE_AMT = 1e48; // {qRTok}
    uint192 public constant MAX_THROTTLE_PCT_AMT = 1e18; // {qRTok}
    uint192 public constant MIN_EXCHANGE_RATE = 1e9; // D18{BU/rTok}
    uint192 public constant MAX_EXCHANGE_RATE = 1e27; // D18{BU/rTok}

    /// Weakly immutable: expected to be an IPFS link but could be the mandate itself
    string public mandate;

    // List of accounts. If issuances[user].length > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    uint192 public basketsNeeded; //  {BU}

    // === Supply throttles ===
    ThrottleLib.Throttle private issuanceThrottle;
    ThrottleLib.Throttle private redemptionThrottle;

    function init(
        IMain main_,
        string memory name_,
        string memory symbol_,
        string calldata mandate_,
        ThrottleLib.Params calldata issuanceThrottleParams_,
        ThrottleLib.Params calldata redemptionThrottleParams_
    ) public initializer {
        require(bytes(name_).length > 0, "name empty");
        require(bytes(symbol_).length > 0, "symbol empty");
        require(bytes(mandate_).length > 0, "mandate empty");
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);

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

        uint256 low = mulDiv256(FIX_ONE_256, basketsNeeded, supply); // {BU/tok}
        uint256 high = mulDiv256(FIX_ONE_256, basketsNeeded, supply, CEIL); // {BU/tok}

        require(
            _safeWrap(low).gte(MIN_EXCHANGE_RATE) && _safeWrap(high).lte(MAX_EXCHANGE_RATE),
            "BU rate out of range"
        );
    }

    /// Issue an RToken with basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction
    function issue(uint256 amount) public {
        issueTo(_msgSender(), amount);
    }

    /// Issue an RToken with basket collateral, to a particular recipient
    /// @param recipient The address to receive the issued RTokens
    /// @param amount {qRTok} The quantity of RToken to issue
    /// @custom:interaction
    function issueTo(address recipient, uint256 amount)
        public
        notPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(amount > 0, "Cannot issue zero");
        // Call collective state keepers.
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() == CollateralStatus.SOUND, "basket unsound");

        // Revert if issuance exceeds either supply throttle
        issuanceThrottle.useAvailable(totalSupply(), int256(amount)); // reverts on over-issuance
        redemptionThrottle.useAvailable(totalSupply(), -int256(amount)); // shouldn't revert

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.muluDivu(amount, totalSupply(), CEIL) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(baskets, CEIL);

        address issuer = _msgSender();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IERC20(erc20s[i]).safeTransferFrom(issuer, address(main.backingManager()), deposits[i]);
        }

        _mint(recipient, amount);
        emit Issuance(issuer, recipient, amount, baskets);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(baskets));
        basketsNeeded = basketsNeeded.plus(baskets);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @param revertOnPartialRedemption If true, will revert on partial redemption
    /// @custom:interaction
    function redeem(uint256 amount, bool revertOnPartialRedemption) external {
        redeemTo(_msgSender(), amount, revertOnPartialRedemption);
    }

    /// Redeem RToken for basket collateral to a particular recipient
    /// @param recipient The address to receive the backing collateral tokens
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @param revertOnPartialRedemption If true, will revert on partial redemption
    /// @custom:interactin
    function redeemTo(
        address recipient,
        uint256 amount,
        bool revertOnPartialRedemption
    ) public notFrozen exchangeRateIsValidAfter {
        require(amount > 0, "Cannot redeem zero");
        require(amount <= balanceOf(_msgSender()), "insufficient balance");

        // Call collective state keepers.
        // notFrozen modifier requires we use only a subset of main.poke()
        main.assetRegistry().refresh();

        // Failure to melt results in a lower redemption price, so we can allow it when paused
        // solhint-disable-next-line no-empty-blocks
        try main.furnace().melt() {} catch {}

        // Revert if redemption exceeds either supply throttle
        issuanceThrottle.useAvailable(totalSupply(), -int256(amount));
        redemptionThrottle.useAvailable(totalSupply(), int256(amount)); // reverts on overuse

        // {BU} = {BU} * {qRTok} / {qRTok}
        uint192 basketsRedeemed = basketsNeeded.muluDivu(amount, totalSupply());
        assert(basketsRedeemed.lte(basketsNeeded));
        emit Redemption(_msgSender(), recipient, amount, basketsRedeemed);

        (address[] memory erc20s, uint256[] memory amounts) = main.basketHandler().quote(
            basketsRedeemed,
            FLOOR
        );

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(basketsRedeemed));
        basketsNeeded = basketsNeeded.minus(basketsRedeemed);

        // ==== Send back collateral tokens ====
        IBackingManager backingMgr = main.backingManager();

        bool allZero = true;
        // Bound each withdrawal by the prorata share, in case we're currently under-collateralized
        for (uint256 i = 0; i < erc20s.length; i++) {
            uint256 bal = IERC20Upgradeable(erc20s[i]).balanceOf(address(backingMgr)); // {qTok}

            // {qTok} = {qTok} * {qRTok} / {qRTok}
            uint256 prorata = mulDiv256(bal, amount, totalSupply()); // FLOOR
            if (prorata < amounts[i]) {
                require(!revertOnPartialRedemption, "partial redemption");
                amounts[i] = prorata;
            }

            // Send withdrawal
            if (amounts[i] > 0) {
                IERC20(erc20s[i]).safeTransferFrom(address(backingMgr), recipient, amounts[i]);
                allZero = false;
            }
        }

        // Accept and burn RToken, reverts if not enough balance
        _burn(_msgSender(), amount);

        if (allZero) revert("empty redemption");
    }

    // ===

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    /// @custom:protected
    function mint(address recipient, uint256 amount)
        external
        notPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        _mint(recipient, amount);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qRTok} The amount to be melted
    function melt(uint256 amount) external notPausedOrFrozen exchangeRateIsValidAfter {
        _burn(_msgSender(), amount);
        require(totalSupply() >= FIX_ONE, "rToken supply too low to melt");
        emit Melted(amount);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    function setBasketsNeeded(uint192 basketsNeeded_)
        external
        notPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// Sends all token balance of erc20 (if it is registered) to the BackingManager
    /// @custom:interaction
    function monetizeDonations(IERC20 erc20) external notPausedOrFrozen {
        require(main.assetRegistry().isRegistered(erc20), "erc20 unregistered");
        erc20.safeTransfer(address(main.backingManager()), erc20.balanceOf(address(this)));
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

    // === Private ===

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
}
