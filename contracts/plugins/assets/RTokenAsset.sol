// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/p1/mixins/RecollateralizationLib.sol";

/// Once an RToken gets large eonugh to get a price feed, replacing this asset with
/// a simpler one will do wonders for gas usage
contract RTokenAsset is IAsset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Component addresses are not mutable in protocol, so it's safe to cache these
    IBasketHandler public immutable basketHandler;
    IAssetRegistry public immutable assetRegistry;
    IBackingManager public immutable backingManager;

    IERC20Metadata public immutable erc20;

    uint8 public immutable erc20Decimals;

    uint192 public immutable override maxTradeVolume; // {UoA}

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(IRToken erc20_, uint192 maxTradeVolume_) {
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");

        IMain main = erc20_.main();
        basketHandler = main.basketHandler();
        assetRegistry = main.assetRegistry();
        backingManager = main.backingManager();

        erc20 = IERC20Metadata(address(erc20_));
        erc20Decimals = erc20_.decimals();
        maxTradeVolume = maxTradeVolume_;
    }

    /// Can return 0 and revert
    /// @return {UoA/tok} An estimate of the current RToken redemption price
    function strictPrice() public view virtual returns (uint192) {
        (bool isFallback, uint192 price_) = price(false);
        require(!isFallback, "RTokenAsset: need fallback prices");
        return price_;
    }

    /// Can return 0
    /// Should not revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return If the price is a failover price
    /// @return {UoA/tok} The current price(), or if it's reverting, a fallback price
    function price(bool allowFallback) public view virtual returns (bool, uint192) {
        // {UoA/BU}
        (bool isFallback_, uint192 price_) = basketHandler.price(allowFallback);

        // Here we take advantage of the fact that we know RToken has 18 decimals
        // to convert between uint256 an uint192. Fits due to assumed max totalSupply.
        uint192 supply = _safeWrap(IRToken(address(erc20)).totalSupply());

        if (supply == 0) return (isFallback_, price_);

        uint192 basketsBottom; // {BU}
        if (basketHandler.fullyCollateralized()) {
            basketsBottom = IRToken(address(erc20)).basketsNeeded();
        } else {
            // Note: Extremely this is extremely wasteful in terms of gas. This only exists so
            // there is _some_ asset to represent the RToken itself when it is deployed, in
            // the absence of an external price feed. Any RToken that gets reasonably big
            // should switch over to an asset with a price feed.

            IMain main = backingManager.main();
            ComponentCache memory components = ComponentCache({
                trader: backingManager,
                bh: main.basketHandler(),
                reg: main.assetRegistry(),
                stRSR: main.stRSR(),
                rsr: main.rsr(),
                rToken: main.rToken()
            });
            TradingRules memory rules = TradingRules({
                minTradeVolume: backingManager.minTradeVolume(),
                maxTradeSlippage: backingManager.maxTradeSlippage()
            });

            // will exclude UoA value from RToken balances at BackingManager
            RecollateralizationLibP1.BasketRange memory range = RecollateralizationLibP1
                .basketRange(components, rules, assetRegistry.erc20s());
            basketsBottom = range.bottom;
        }

        // {UoA/tok} = {BU} * {UoA/BU} / {tok}
        return (isFallback_, basketsBottom.mulDiv(price_, supply));
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (uint192) {
        // The RToken has 18 decimals, so there's no reason to waste gas here doing a shiftl_toFix
        // return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
        return _safeWrap(erc20.balanceOf(account));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    // solhint-disable no-empty-blocks

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev Use delegatecall
    function claimRewards() external virtual {}

    // solhint-enable no-empty-blocks
}
