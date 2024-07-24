// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../p1/mixins/RecollateralizationLib.sol";
import "../../interfaces/IMain.sol";
import "../../interfaces/IRToken.sol";
import "../../interfaces/IRTokenOracle.sol";
import "./Asset.sol";
import "./VersionedAsset.sol";

uint256 constant ORACLE_TIMEOUT = 15 minutes;

/// Once an RToken gets large enough to get a price feed, replacing this asset with
/// a simpler one will do wonders for gas usage
/// @dev This RTokenAsset is ONLY compatible with Protocol ^3.0.0
contract RTokenAsset is IAsset, VersionedAsset, IRTokenOracle {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Component addresses are not mutable in protocol, so it's safe to cache these
    IAssetRegistry public immutable assetRegistry;
    IBasketHandler public immutable basketHandler;
    IBackingManager public immutable backingManager;
    IFurnace public immutable furnace;

    IERC20Metadata public immutable erc20; // The RToken

    uint8 public immutable erc20Decimals;

    uint192 public immutable maxTradeVolume; // {UoA}

    // Oracle State
    CachedOracleData public cachedOracleData;

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(IRToken erc20_, uint192 maxTradeVolume_) {
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ != 0, "invalid max trade volume");

        IMain main = erc20_.main();
        assetRegistry = main.assetRegistry();
        basketHandler = main.basketHandler();
        backingManager = main.backingManager();
        furnace = main.furnace();

        erc20 = IERC20Metadata(address(erc20_));
        erc20Decimals = erc20_.decimals();
        maxTradeVolume = maxTradeVolume_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @dev This method for calculating the price can provide a 2x larger range than the average
    ///   oracleError of the RToken's backing collateral. This only occurs when there is
    ///   less RSR overcollateralization in % terms than the average (weighted) oracleError.
    ///   This arises from the use of oracleErrors inside of `basketRange()` and inside
    ///   `basketHandler.price()`. When `range.bottom == range.top` then there is no compounding.
    /// @dev This method should not be relied upon to provide precise bounds for secondary market
    ///   prices. It is a "reasonable" estimate of the range the RToken is expected to trade in
    ///   given what the protocol knows about its internal state, but strictly speaking RTokens
    ///   can trade outside this range for periods of time (ie increased demand during IFFY state)
    ///   It is therefore NOT recommended to rely on this pricing method to price RTokens
    ///   in lending markets or anywhere where secondary market price is the central concern.
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    function tryPrice() external view virtual returns (uint192 low, uint192 high) {
        (uint192 lowBUPrice, uint192 highBUPrice) = basketHandler.price(true); // {UoA/BU}
        require(lowBUPrice != 0 && highBUPrice != FIX_MAX, "invalid price");
        assert(lowBUPrice <= highBUPrice); // not obviously true just by inspection

        // Here we take advantage of the fact that we know RToken has 18 decimals
        // to convert between uint256 an uint192. Fits due to assumed max totalSupply.
        uint192 supply = _safeWrap(IRToken(address(erc20)).totalSupply());

        if (supply == 0) return (lowBUPrice, highBUPrice);

        // The RToken's basket range is not symmetric!
        // range.bottom is additionally lower because of the slippage from the shortfall
        BasketRange memory range = basketRange(); // {BU}

        // {UoA/tok} = {BU} * {UoA/BU} / {tok}
        low = range.bottom.mulDiv(lowBUPrice, supply, FLOOR);
        high = range.top.mulDiv(highBUPrice, supply, CEIL);

        assert(low <= high); // not obviously true
    }

    function refresh() public virtual override {
        // No need to save lastPrice; can piggyback off the backing collateral's saved prices

        furnace.melt();
        if (msg.sender != address(assetRegistry)) assetRegistry.refresh();

        cachedOracleData.cachedAtTime = 0; // force oracle refresh
    }

    /// Should not revert
    /// @dev See `tryPrice` caveats
    /// @return {UoA/tok} The lower end of the price estimate
    /// @return {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192, uint192) {
        try this.tryPrice() returns (uint192 low, uint192 high) {
            return (low, high);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return (0, FIX_MAX);
        }
    }

    /// Should not revert
    /// lotLow should be nonzero when the asset might be worth selling
    /// @dev Deprecated. Phased out in 3.1.0, but left on interface for backwards compatibility
    /// @return lotLow {UoA/tok} The lower end of the lot price estimate
    /// @return lotHigh {UoA/tok} The upper end of the lot price estimate
    function lotPrice() external view virtual returns (uint192 lotLow, uint192 lotHigh) {
        return price();
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        // The RToken has 18 decimals, so there's no reason to waste gas here doing a shiftl_toFix
        // return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
        return _safeWrap(erc20.balanceOf(account));
    }

    /// @return {s} The timestamp of the last refresh; always 0 since prices are never saved
    function lastSave() external pure returns (uint48) {
        return 0;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    // solhint-disable no-empty-blocks

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks

    /// Force an update to the cache, including refreshing underlying assets
    /// @dev Can revert if RToken is unpriced
    function forceUpdatePrice() external {
        _updateCachedPrice();
    }

    /// @dev Can revert if RToken is unpriced
    /// @return rTokenPrice {UoA/tok} The mean price estimate
    /// @return updatedAt {s} The timestamp of the cache update
    function latestPrice() external returns (uint192 rTokenPrice, uint256 updatedAt) {
        // Situations that require an update, from most common to least common.
        // untestable:
        //     basket and trade nonce checks, as first condition will always be true in these cases
        if (
            cachedOracleData.cachedAtTime + ORACLE_TIMEOUT <= block.timestamp || // Cache Timeout
            cachedOracleData.cachedAtNonce != basketHandler.nonce() || // Basket nonce was updated
            cachedOracleData.cachedTradesNonce != backingManager.tradesNonce() || // New trades
            cachedOracleData.cachedTradesOpen != backingManager.tradesOpen() // ..or settled
        ) {
            _updateCachedPrice();
        }

        rTokenPrice = cachedOracleData.cachedPrice;
        updatedAt = cachedOracleData.cachedAtTime;
    }

    // ==== Private ====

    // Update Oracle Data
    function _updateCachedPrice() internal {
        assetRegistry.refresh(); // will call furnace.melt()

        (uint192 low, uint192 high) = price();
        require(low != 0 && high != FIX_MAX, "invalid price");

        cachedOracleData = CachedOracleData(
            (low + high) / 2,
            block.timestamp,
            basketHandler.nonce(),
            backingManager.tradesOpen(),
            backingManager.tradesNonce()
        );
    }

    /// Computationally expensive basketRange calculation; used in price()
    function basketRange() private view returns (BasketRange memory range) {
        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(backingManager));
        uint192 basketsNeeded = IRToken(address(erc20)).basketsNeeded(); // {BU}

        // if (basketHandler.fullyCollateralized())
        if (basketsHeld.bottom >= basketsNeeded) {
            range.bottom = basketsNeeded;
            range.top = basketsNeeded;
        } else {
            // Note: Extremely this is extremely wasteful in terms of gas. This only exists so
            // there is _some_ asset to represent the RToken itself when it is deployed, in
            // the absence of an external price feed. Any RToken that gets reasonably big
            // should switch over to an asset with a price feed.

            (TradingContext memory ctx, Registry memory reg) = backingManager.tradingContext(
                basketsHeld
            );

            // will exclude UoA value from RToken balances at BackingManager
            range = RecollateralizationLibP1.basketRange(ctx, reg);
        }
    }
}
