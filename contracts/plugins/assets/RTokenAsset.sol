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
// @dev This RTokenAsset is ONLY compatible with Protocol ^3.0.0
contract RTokenAsset is IAsset, VersionedAsset, IRTokenOracle {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Component addresses are not mutable in protocol, so it's safe to cache these
    IMain public immutable main;
    IBasketHandler public immutable basketHandler;
    IAssetRegistry public immutable assetRegistry;
    IBackingManager public immutable backingManager;
    IRToken public immutable rToken;

    IERC20Metadata public immutable erc20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable maxTradeVolume; // {UoA}

    // Oracle State
    CachedOracleData public cachedOracleData;

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(IRToken erc20_, uint192 maxTradeVolume_) {
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");

        main = erc20_.main();
        basketHandler = main.basketHandler();
        assetRegistry = main.assetRegistry();
        backingManager = main.backingManager();
        rToken = main.rToken();

        erc20 = IERC20Metadata(address(erc20_));
        erc20Decimals = erc20_.decimals();
        maxTradeVolume = maxTradeVolume_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    function tryPrice() external view virtual returns (uint192 low, uint192 high) {
        (uint192 lowBUPrice, uint192 highBUPrice) = basketHandler.price(); // {UoA/BU}
        assert(lowBUPrice <= highBUPrice); // not obviously true just by inspection

        // Here we take advantage of the fact that we know RToken has 18 decimals
        // to convert between uint256 an uint192. Fits due to assumed max totalSupply.
        uint192 supply = _safeWrap(IRToken(address(erc20)).totalSupply());

        if (supply == 0) return (lowBUPrice, highBUPrice);

        // The RToken's price is not symmetric like other assets!
        // range.bottom is lower because of the slippage from the shortfall
        BasketRange memory range = basketRange(); // {BU}

        // {UoA/tok} = {BU} * {UoA/BU} / {tok}
        low = range.bottom.mulDiv(lowBUPrice, supply, FLOOR);
        high = range.top.mulDiv(highBUPrice, supply, CEIL);

        assert(low <= high); // not obviously true
    }

    // solhint-disable no-empty-blocks
    function refresh() public virtual override {
        // No need to save lastPrice; can piggyback off the backing collateral's saved prices

        cachedOracleData.cachedAtTime = 0; // force oracle refresh
    }

    // solhint-enable no-empty-blocks

    /// Should not revert
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
    /// DEPRECATED: claimRewards() will be removed from all assets and collateral plugins
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks

    function forceUpdatePrice() external {
        _updateCachedPrice();
    }

    function latestPrice() external returns (uint192 rTokenPrice, uint256 updatedAt) {
        // Situations that require an update, from most common to least common.
        if (
            cachedOracleData.cachedAtTime + ORACLE_TIMEOUT <= block.timestamp || // Cache Timeout
            cachedOracleData.cachedAtNonce != basketHandler.nonce() || // Basket nonce was updated
            cachedOracleData.cachedTradesNonce != backingManager.tradesNonce() || // New trades
            cachedOracleData.cachedTradesOpen != backingManager.tradesOpen() // ..or settled
        ) {
            _updateCachedPrice();
        }

        return (cachedOracleData.cachedPrice, cachedOracleData.cachedAtTime);
    }

    // ==== Private ====

    // Update Oracle Data
    function _updateCachedPrice() internal {
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

            TradingContext memory ctx;

            ctx.basketsHeld = basketsHeld;
            ctx.bm = backingManager;
            ctx.bh = basketHandler;
            ctx.ar = assetRegistry;
            ctx.stRSR = main.stRSR();
            ctx.rsr = main.rsr();
            ctx.rToken = main.rToken();
            ctx.minTradeVolume = backingManager.minTradeVolume();
            ctx.maxTradeSlippage = backingManager.maxTradeSlippage();

            // Calculate cached values
            Registry memory reg = ctx.ar.getRegistry();
            uint256 len = reg.erc20s.length;
            ctx.quantities = new uint192[](len);
            ctx.lowPrices = new uint192[](len);
            ctx.highPrices = new uint192[](len);
            for (uint256 i = 0; i < len; ++i) {
                ctx.quantities[i] = ctx.bh.quantityUnsafe(reg.erc20s[i], reg.assets[i]);
                if (address(reg.erc20s[i]) != address(rToken)) {
                    (ctx.lowPrices[i], ctx.highPrices[i]) = reg.assets[i].price();
                } else {
                    ctx.highPrices[i] = FIX_MAX; // should go un-used, but just to be safe
                }
            }

            // will exclude UoA value from RToken balances at BackingManager
            range = RecollateralizationLibP1.basketRange(ctx, reg);
        }
    }
}
