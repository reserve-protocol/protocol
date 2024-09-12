// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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

    /// Issue an RToken on the current basket
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction
    function issue(uint256 amount) public {
        issueTo(_msgSender(), amount);
    }

    /// Issue an RToken on the current basket, to a particular recipient
    /// @param recipient The address to receive the issued RTokens
    /// @param amount {qRTok} The quantity of RToken to issue
    /// @custom:interaction
    function issueTo(address recipient, uint256 amount)
        public
        notIssuancePausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(amount > 0, "Cannot issue zero");
        // Call collective state keepers.
        main.poke();

        // Ensure basket is ready, SOUND and not in warmup period
        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.isReady(), "basket not ready");

        // Revert if issuance exceeds either supply throttle
        issuanceThrottle.useAvailable(totalSupply(), int256(amount)); // reverts on over-issuance
        redemptionThrottle.useAvailable(totalSupply(), -int256(amount)); // shouldn't revert

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.muluDivu(amount, totalSupply(), CEIL) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(
            baskets,
            true,
            CEIL
        );

        address issuer = _msgSender();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IERC20(erc20s[i]).safeTransferFrom(issuer, address(main.backingManager()), deposits[i]);
        }

        _scaleUp(recipient, baskets);
        emit Issuance(issuer, recipient, amount, baskets);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction
    function redeem(uint256 amount) external {
        redeemTo(_msgSender(), amount);
    }

    /// Redeem RToken for basket collateral to a particular recipient
    /// @param recipient The address to receive the backing collateral tokens
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction
    function redeemTo(address recipient, uint256 amount) public notFrozen exchangeRateIsValidAfter {
        // Call collective state keepers.
        main.poke();

        require(amount > 0, "Cannot redeem zero");
        require(amount <= balanceOf(_msgSender()), "insufficient balance");
        require(main.basketHandler().fullyCollateralized(), "partial redemption; use redeemCustom");
        // redemption while IFFY/DISABLED allowed

        // Revert if redemption exceeds either supply throttle
        issuanceThrottle.useAvailable(totalSupply(), -int256(amount));
        redemptionThrottle.useAvailable(totalSupply(), int256(amount)); // reverts on overuse

        // {BU}
        uint192 baskets = _scaleDown(_msgSender(), amount);
        emit Redemption(_msgSender(), recipient, amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = main.basketHandler().quote(
            baskets,
            false,
            FLOOR
        );

        // ==== Send out balances ====
        for (uint256 i = 0; i < erc20s.length; i++) {
            // Send withdrawal
            if (amounts[i] > 0) {
                IERC20(erc20s[i]).safeTransferFrom(
                    address(main.backingManager()),
                    recipient,
                    amounts[i]
                );
            }
        }
    }

    /// Redeem RToken for a linear combination of historical baskets, to a particular recipient
    /// @param recipient The address to receive the backing collateral tokens
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @param basketNonces An array of basket nonces to do redemption from
    /// @param portions {1} An array of Fix quantities that must add up to FIX_ONE
    /// @param expectedERC20sOut An array of ERC20s expected out
    /// @param minAmounts {qTok} The minimum ERC20 quantities the caller should receive
    /// @custom:interaction
    function redeemCustom(
        address recipient,
        uint256 amount,
        uint48[] memory basketNonces,
        uint192[] memory portions,
        address[] memory expectedERC20sOut,
        uint256[] memory minAmounts
    ) external notFrozen exchangeRateIsValidAfter {
        require(amount > 0, "Cannot redeem zero");
        require(amount <= balanceOf(_msgSender()), "insufficient balance");

        // Call collective state keepers.
        main.poke();

        uint256 supply = totalSupply();

        // Revert if redemption exceeds either supply throttle
        issuanceThrottle.useAvailable(supply, -int256(amount));
        redemptionThrottle.useAvailable(supply, int256(amount)); // reverts on overuse

        // {BU}
        uint192 basketsRedeemed = _scaleDown(_msgSender(), amount);
        emit Redemption(_msgSender(), recipient, amount, basketsRedeemed);

        // === Get basket redemption amounts ===

        {
            uint256 portionsSum;
            for (uint256 i = 0; i < portions.length; ++i) {
                portionsSum += portions[i];
            }
            require(portionsSum == FIX_ONE, "portions do not add up to FIX_ONE");
        }

        (address[] memory erc20s, uint256[] memory amounts) = main
        .basketHandler()
        .quoteCustomRedemption(basketNonces, portions, basketsRedeemed);

        // === Save initial recipient balances ===

        uint256[] memory pastBals = new uint256[](expectedERC20sOut.length);
        for (uint256 i = 0; i < expectedERC20sOut.length; ++i) {
            pastBals[i] = IERC20(expectedERC20sOut[i]).balanceOf(recipient);
        }

        // ==== Prorate redemption + send out balances ====
        {
            bool allZero = true;
            // Bound each withdrawal by the prorata share, in case currently under-collateralized
            for (uint256 i = 0; i < erc20s.length; i++) {
                // {qTok} = {qTok} * {qRTok} / {qRTok}
                uint256 prorata = mulDiv256(
                    IERC20(erc20s[i]).balanceOf(address(main.backingManager())),
                    amount,
                    supply
                ); // FLOOR
                if (prorata < amounts[i]) amounts[i] = prorata;

                // Send withdrawal
                if (amounts[i] > 0) {
                    IERC20(erc20s[i]).safeTransferFrom(
                        address(main.backingManager()),
                        recipient,
                        amounts[i]
                    );
                    allZero = false;
                }
            }
            if (allZero) revert("empty redemption");
        }

        // === Post-checks ===

        // Check post-balances
        for (uint256 i = 0; i < expectedERC20sOut.length; ++i) {
            uint256 bal = IERC20(expectedERC20sOut[i]).balanceOf(recipient);
            require(bal - pastBals[i] >= minAmounts[i], "redemption below minimum");
        }
    }

    // ===

    /// Mint an amount of RToken equivalent to baskets BUs, scaling basketsNeeded up
    /// Callable only by BackingManager
    /// @param baskets {BU} The number of baskets to mint RToken for
    /// @custom:protected
    function mint(uint192 baskets) external exchangeRateIsValidAfter {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        _scaleUp(address(main.backingManager()), baskets);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qRTok} The amount to be melted
    /// @custom:protected
    function melt(uint256 amount) external exchangeRateIsValidAfter {
        require(_msgSender() == address(main.furnace()), "furnace only");
        _burn(_msgSender(), amount);
        emit Melted(amount);
    }

    /// Dissolve an amount of RToken from caller's account and scale basketsNeeded down
    /// Callable only by backingManager
    /// @param amount {qRTok}
    /// @custom:protected
    function dissolve(uint256 amount) external exchangeRateIsValidAfter {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        _scaleDown(_msgSender(), amount);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    function setBasketsNeeded(uint192 basketsNeeded_)
        external
        notTradingPausedOrFrozen
        exchangeRateIsValidAfter
    {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        require(totalSupply() > 0, "0 supply");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// Sends all token balance of erc20 (if it is registered) to the BackingManager
    /// @custom:interaction
    function monetizeDonations(IERC20 erc20) external notTradingPausedOrFrozen {
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

    // === Private ===

    /// Mint an amount of RToken equivalent to amtBaskets and scale basketsNeeded up
    /// @param recipient The address to receive the RTokens
    /// @param amtBaskets {BU} The number of amtBaskets to mint RToken for
    function _scaleUp(address recipient, uint192 amtBaskets) private {
        uint256 amtRToken = totalSupply() > 0
            ? amtBaskets.muluDivu(totalSupply(), uint256(basketsNeeded))
            : amtBaskets; // {rTok}
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(amtBaskets));
        basketsNeeded = basketsNeeded.plus(amtBaskets);

        // Mint RToken to recipient
        _mint(recipient, amtRToken); // take advantage of 18 decimals in cast
    }

    /// Burn an amount of RToken and scale basketsNeeded down
    /// @param account The address to dissolve RTokens from
    /// @param amtRToken {qRTok} The amount of RToken to be dissolved
    /// @return amtBaskets {BU} The equivalent number of baskets dissolved
    function _scaleDown(address account, uint256 amtRToken) private returns (uint192 amtBaskets) {
        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        amtBaskets = basketsNeeded.muluDivu(amtRToken, totalSupply()); // FLOOR
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(amtBaskets));
        basketsNeeded = basketsNeeded.minus(amtBaskets);

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
}
