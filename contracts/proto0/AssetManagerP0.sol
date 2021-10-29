// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/Auction.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IAssetManager.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IVault.sol";
import "./FurnaceP0.sol";
import "./RTokenP0.sol";
import "./StRSRP0.sol";

/**
 * @title AssetManagerP0
 * @dev Handles the transfer and trade of assets.
 *
 * This contract:
 *    - Manages the choice of backing of an RToken via Vault selection.
 *    - Defines the exchange rate between Vault BUs and RToken supply, via the base factor.
 *    - Runs 3 types of auctions:
 *          A. Asset-for-asset             (Migration auctions)
 *          B. RSR-for-RToken              (Recapitalization auctions)
 *          C. COMP/AAVE-for-RToken        (Revenue auctions)
 */
contract AssetManagerP0 is IAssetManager, Ownable {
    using SafeERC20 for IERC20;
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;
    using Oracle for Oracle.Info;

    uint256 public constant SCALE = 1e18;

    // ECONOMICS (Note that SCALE is ignored here. These are the abstract mathematical relationships)
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatio / _basketDilutionRatio
    // _meltingRatio = (total supply + melting) / total supply
    // _basketDilutionRatio = _currentBasketDilution * _historicalBasketDilution
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    // Basket Dilution
    uint256 internal _currentBasketDilution = 1e18; // for this current vault, since the last time *f* was changed
    uint256 internal _historicalBasketDilution = 1e18; // the product of all historical basket dilutions
    uint256 internal _prevBasketFiatcoinRate; // redemption value of the basket in fiatcoins last update

    EnumerableSet.AddressSet internal _approvedCollateralAssets;
    EnumerableSet.AddressSet internal _allCollateralAssets;
    EnumerableSet.AddressSet internal _fiatcoins;

    IMain public main;
    IVault public override vault;

    // Append-only record keeping
    IVault[] public pastVaults;
    Auction.Info[] public auctions;

    constructor(
        IMain main_,
        IVault vault_,
        address owner_,
        IAsset[] memory approvedAssets_
    ) {
        main = main_;
        vault = vault_;
        _prevBasketFiatcoinRate = vault.basketFiatcoinRate();

        for (uint256 i = 0; i < approvedAssets_.length; i++) {
            _approveAsset(approvedAssets_[i]);
        }

        if (!vault.containsOnly(_approvedCollateralAssets.values())) {
            revert CommonErrors.UnapprovedAsset();
        }

        _accumulate();

        main.rsr().approve(address(main.stRSR()), type(uint256).max);
        _transferOwnership(owner_);
    }

    modifier onlyMain() {
        require(_msgSender() == address(main), "main only");
        _;
    }

    // This modifier runs before every function including redemption, so it needs to be very safe.
    modifier always() {
        main.furnace().doBurn();
        _diluteBasket();
        _;
    }

    // Begins an issuance by saving parameters of the current system to a SlowIssuance struct.
    // Does not set *blockAvailableAt*.
    function beginIssuance(address issuer, uint256 amount)
        external
        override
        onlyMain
        always
        returns (SlowIssuance memory issuance)
    {
        issuance.vault = vault;
        issuance.amount = amount;
        issuance.BUs = _toBUs(amount);
        issuance.basketAmounts = vault.tokenAmounts(_toBUs(amount));
        issuance.issuer = issuer;
    }

    // Pulls BUs over from Main and mints RToken to the issuer. Called at the end of SlowIssuance.
    function completeIssuance(SlowIssuance memory issuance) external override onlyMain always {
        issuance.vault.pullBUs(address(main), issuance.BUs); // Main should have set an allowance
        main.rToken().mint(issuance.issuer, issuance.amount);
    }

    // Transfers collateral to the redeemers account at the current BU exchange rate.
    function redeem(address redeemer, uint256 amount) external override onlyMain always {
        main.rToken().burn(redeemer, amount);
        _oldestNonEmptyVault().redeem(redeemer, _toBUs(amount));
    }

    // Claims COMP + AAVE from Vault + Manager and expands the RToken supply.
    function collectRevenue() external override onlyMain {
        vault.claimAndSweepRewardsToManager();
        main.comptroller().claimComp(address(this));
        IStaticAToken(address(main.aaveAsset().erc20())).claimRewardsToSelf(true);

        // Expand the RToken supply to self
        uint256 possible = _fromBUs(vault.basketUnits(address(this)));
        if (fullyCapitalized() && possible > main.rToken().totalSupply()) {
            main.rToken().mint(address(this), possible - main.rToken().totalSupply());
        }
    }

    // Unapproves the defaulting asset and switches the RToken over to a new Vault.
    function switchVaults(IAsset[] memory defaulting) external override onlyMain {
        for (uint256 i = 0; i < defaulting.length; i++) {
            _unapproveAsset(defaulting[i]);
        }

        IVault newVault = main.monitor().getNextVault(vault, _approvedCollateralAssets.values(), _fiatcoins.values());
        if (address(newVault) != address(0)) {
            _switchVault(newVault);
        }
    }

    // Upon vault change or change to *f*, we accumulate the historical dilution factor.
    function accumulate() external override onlyMain {
        _accumulate();
    }

    // Continually runs auctions as long as we are undercollateralized.
    // Algorithm:
    //     1. Closeout previous auctions
    //     2. Create BUs from spare assets
    //     3. Break off BUs from the old vault for more assets if we are undercapitalized
    //     4. Launch asset-for-asset auctions until we are left with only dust
    //     5. If it's all dust: sell RSR and buy RToken and burn it
    //     6. If we run out of RSR: give RToken holders a haircut to get back to capitalized
    // That's all just to get to the point of capitalization. 
    // Once we are capitalized we perform revenue auctions. 
    function runAuctions() external override onlyMain always returns (State) {
        // Closeout open auctions or sleep if they are still ongoing.
        for (uint256 i = 0; i < auctions.length; i++) {
            Auction.Info storage auction = auctions[i];
            if (auction.open) {
                if (block.timestamp <= auction.endTime) {
                    return State.TRADING;
                }

                uint256 boughtAmount = auction.process(main);
                if (!auction.clearedCloseToOraclePrice(main, boughtAmount)) {
                    return State.PRECAUTIONARY;
                }
            }
        }

        // Create as many BUs as we can
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            vault.issue(issuable);
        }

        IAsset sell;
        IAsset buy;
        uint256 maxSell;
        uint256 targetBuy;
        bool worth;
        Auction.Info memory auction;
        Config memory config = main.config();
        IVault oldVault = _oldestNonEmptyVault();

        // If we are not fully capitalized, prioritize recapitalization auctions
        if (!fullyCapitalized()) {
            // Are we able to trade sideways, or is it all dust?
            (sell, buy, maxSell, targetBuy) = _largestCollateralForCollateralTrade();
            (worth, auction) = _prepareTargetBuyAuction(
                config.minRecapitalizationAuctionSize,
                sell,
                buy,
                maxSell,
                targetBuy,
                Fate.Stay
            );

            // Redeem BUs to open up spare collateral assets
            uint256 totalSupply = main.rToken().totalSupply();
            if (!worth && oldVault != vault) {
                uint256 max = _toBUs(((totalSupply) * config.migrationChunk) / SCALE);
                uint256 chunk = Math.min(max, oldVault.basketUnits(address(this)));
                oldVault.redeem(address(this), chunk);

                // Are we able to trade sideways, or is it all dust?
                (sell, buy, maxSell, targetBuy) = _largestCollateralForCollateralTrade();
                (worth, auction) = _prepareTargetBuyAuction(
                    config.minRecapitalizationAuctionSize,
                    sell,
                    buy,
                    maxSell,
                    targetBuy,
                    Fate.Stay
                );
            } else if (!worth && main.rsr().balanceOf(address(main.stRSR())) > 0) {
                // Recapitalization: RSR -> RToken
                (worth, auction) = _prepareTargetBuyAuction(
                    config.minRecapitalizationAuctionSize,
                    main.rsrAsset(),
                    main.rTokenAsset(),
                    main.rsr().balanceOf(address(main.stRSR())),
                    totalSupply - _fromBUs(vault.basketUnits(address(this))),
                    Fate.Burn
                );

                if (worth) {
                    main.stRSR().seizeRSR(auction.sellAmount - main.rsr().balanceOf(address(this)));
                }
            } else if (!worth) {
                // We've reached the endgame...time to concede and give RToken holders a haircut.
                _accumulate();
                uint256 melting = (SCALE * (totalSupply + main.furnace().totalBurnt())) / totalSupply;
                _historicalBasketDilution = (melting * vault.basketUnits(address(this))) / totalSupply;
                return State.CALM;
            }

            auctions.push(auction);
            auctions[auctions.length - 1].launch();
            return State.TRADING;
        }

        // AT THIS POINT WE ARE CAPITALIZED ALREADY...time for Revenue auctions!

        // First entirely empty old vault of BUs
        if (oldVault != vault) {
            oldVault.redeem(address(this), oldVault.basketUnits(address(this)));
        }

        // RToken -> dividend RSR
        (worth, auction) = _prepareTargetSellAuction(
            config.minRevenueAuctionSize,
            main.rTokenAsset(),
            main.rsrAsset(),
            main.rToken().balanceOf(address(this)),
            Fate.Stake
        );
        if (worth) {
            auctions.push(auction);
            auctions[auctions.length - 1].launch();
            return State.TRADING;
        }

        // COMP -> dividend RSR + melting RToken
        uint256 amountTimesF = (main.compAsset().erc20().balanceOf(address(this)) * config.f) / SCALE;
        uint256 amountTimesOneMinusF = main.compAsset().erc20().balanceOf(address(this)) - amountTimesF;
        (worth, auction) = _prepareTargetSellAuction(
            config.minRevenueAuctionSize,
            main.compAsset(),
            main.rsrAsset(),
            amountTimesF,
            Fate.Stake
        );
        (bool worth2, Auction.Info memory auction2) = _prepareTargetSellAuction(
            config.minRevenueAuctionSize,
            main.compAsset(),
            main.rTokenAsset(),
            amountTimesOneMinusF,
            Fate.Melt
        );

        if (!worth || !worth2) {
            // AAVE -> dividend RSR + melting RToken
            amountTimesF = (main.aaveAsset().erc20().balanceOf(address(this)) * config.f) / SCALE;
            amountTimesOneMinusF = main.aaveAsset().erc20().balanceOf(address(this)) - amountTimesF;
            (worth, auction) = _prepareTargetSellAuction(
                config.minRevenueAuctionSize,
                main.aaveAsset(),
                main.rsrAsset(),
                amountTimesF,
                Fate.Stake
            );
            (worth2, auction2) = _prepareTargetSellAuction(
                config.minRevenueAuctionSize,
                main.aaveAsset(),
                main.rTokenAsset(),
                amountTimesOneMinusF,
                Fate.Melt
            );
        }

        if (worth && worth2) {
            auctions.push(auction);
            auctions[auctions.length - 1].launch();
            auctions.push(auction2);
            auctions[auctions.length - 1].launch();
            return State.TRADING;
        }
        return State.CALM;
    }

    //

    function approveAsset(IAsset asset) external onlyOwner {
        _approveAsset(asset);
    }

    function unapproveAsset(IAsset asset) external onlyOwner {
        _unapproveAsset(asset);
    }

    function switchVault(IVault vault_) external onlyOwner {
        _switchVault(vault_);
    }

    //

    function quote(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return vault.tokenAmounts(_toBUs(amount));
    }

    function fullyCapitalized() public view override returns (bool) {
        return vault.basketUnits(address(this)) >= _toBUs(main.rToken().totalSupply());
    }

    function approvedFiatcoinAssets() external view override returns (address[] memory) {
        return _fiatcoins.values();
    }

    //

    // RToken -> BUs
    function _toBUs(uint256 amount) internal view returns (uint256) {
        uint256 totalSupply = main.rToken().totalSupply();
        if (totalSupply == 0) {
            return amount;
        }
        uint256 melting = (SCALE * (totalSupply + main.furnace().totalBurnt())) / totalSupply;
        uint256 basketDilution = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
        return (amount * basketDilution) / melting;
    }

    // BUs -> RToken
    function _fromBUs(uint256 amount) internal view returns (uint256) {
        uint256 totalSupply = main.rToken().totalSupply();
        if (totalSupply == 0) {
            return amount;
        }
        uint256 melting = (SCALE * (totalSupply + main.furnace().totalBurnt())) / totalSupply;
        uint256 basketDilution = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
        return (amount * melting) / basketDilution;
    }

    // Returns the oldest vault that contains nonzero BUs.
    // Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    // contains no asset tokens.
    function _oldestNonEmptyVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    //

    //  Internal helper to accumulate the historical dilution factor.
    function _accumulate() internal {
        // Idempotent
        _diluteBasket();
        _historicalBasketDilution = (_historicalBasketDilution * _currentBasketDilution) / SCALE;
        _currentBasketDilution = SCALE;
        _prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    function _switchVault(IVault vault_) internal {
        pastVaults.push(vault_);
        vault = vault_;

        // Accumulate the basket dilution factor to enable correct forward accounting
        _accumulate();
    }

    function _approveAsset(IAsset asset) internal {
        _approvedCollateralAssets.add(address(asset));
        _allCollateralAssets.add(address(asset));
        if (asset.isFiatcoin()) {
            _fiatcoins.add(address(asset));
        }
    }

    function _unapproveAsset(IAsset asset) internal {
        _approvedCollateralAssets.remove(address(asset));
        if (asset.isFiatcoin()) {
            _fiatcoins.remove(address(asset));
        }
    }

    // Reduces basket quantities slightly in order to pass through basket appreciation to stakers.
    // Uses a closed-form calculation that is anchored to the last time the vault or *f* was changed.
    // Idempotent
    function _diluteBasket() internal {
        if (_prevBasketFiatcoinRate - SCALE > 0) {
            uint256 current = vault.basketFiatcoinRate();
            _currentBasketDilution = SCALE + main.config().f * ((SCALE * current) / _prevBasketFiatcoinRate - SCALE);
        }
    }

    // Determines what the largest collateral-for-collateral trade is.
    // Algorithm:
    //     1. Target a particular number of basket units based on total fiatcoins held across all asset.
    //     2. Choose the most in-surplus and most in-deficit collateral assets for trading.
    // Returns: (sell asset, buy asset, max sell amount, target buy amount)
    function _largestCollateralForCollateralTrade()
        internal
        view
        returns (
            IAsset,
            IAsset,
            uint256,
            uint256
        )
    {
        // Calculate a BU target (if we could trade with 0 slippage)
        uint256 totalValue;
        for (uint256 i = 0; i < _allCollateralAssets.length(); i++) {
            IAsset a = IAsset(_allCollateralAssets.at(i));
            totalValue += IERC20(a.erc20()).balanceOf(address(this)) * a.priceUSD(main);
        }
        uint256 BUTarget = (totalValue * SCALE) / vault.basketFiatcoinRate();

        // Calculate surplus and deficits relative to the BU target.
        uint256[] memory surplus = new uint256[](_allCollateralAssets.length());
        uint256[] memory deficit = new uint256[](_allCollateralAssets.length());
        for (uint256 i = 0; i < _allCollateralAssets.length(); i++) {
            IAsset a = IAsset(_allCollateralAssets.at(i));
            uint256 bal = IERC20(a.erc20()).balanceOf(address(this));
            uint256 target = (vault.quantity(a) * BUTarget) / SCALE;
            if (bal > target) {
                surplus[i] = ((bal - target) * a.priceUSD(main)) / SCALE;
            } else if (bal < target) {
                deficit[i] = ((target - bal) * a.priceUSD(main)) / SCALE;
            }
        }

        // Calculate the maximums.
        uint256 sellIndex;
        uint256 buyIndex;
        uint256 surplusMax;
        uint256 deficitMax;
        for (uint256 i = 0; i < _allCollateralAssets.length(); i++) {
            if (surplus[i] > surplusMax) {
                surplusMax = surplus[i];
                sellIndex = i;
            }
            if (deficit[i] > deficitMax) {
                deficitMax = deficit[i];
                buyIndex = i;
            }
        }

        IAsset sell = IAsset(_allCollateralAssets.at(sellIndex));
        IAsset buy = IAsset(_allCollateralAssets.at(buyIndex));
        uint256 maxSellAmount = (surplusMax * SCALE) / sell.priceUSD(main);
        uint256 buyAmount = (deficitMax * SCALE) / buy.priceUSD(main);
        return (sell, buy, maxSellAmount, buyAmount);
    }

    // Prepares an auction where *sellAmount* is the independent variable and *minBuyAmount* is dependent.
    // Returns false as the first parameter if *sellAmount* is only dust.
    function _prepareTargetSellAuction(
        uint256 minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 sellAmount,
        Fate fate
    ) internal returns (bool, Auction.Info memory emptyAuction) {
        sellAmount = Math.min(sellAmount, sell.erc20().balanceOf(address(this)));

        uint256 rTokenMarketCapUSD = (main.rTokenAsset().priceUSD(main) * main.rToken().totalSupply()) / SCALE;
        uint256 maxSellUSD = (rTokenMarketCapUSD * main.config().maxAuctionSize) / SCALE;
        uint256 minSellUSD = (rTokenMarketCapUSD * minAuctionSize) / SCALE;

        if (sellAmount < (minSellUSD * SCALE) / sell.priceUSD(main)) {
            return (false, emptyAuction);
        }

        sellAmount = Math.min(sellAmount, (maxSellUSD * SCALE) / sell.priceUSD(main));
        uint256 exactBuyAmount = (sellAmount * sell.priceUSD(main)) / buy.priceUSD(main);
        uint256 minBuyAmount = (exactBuyAmount * (SCALE - main.config().maxTradeSlippage)) / SCALE;
        return (
            true,
            Auction.Info({
                sellAsset: sell,
                buyAsset: buy,
                sellAmount: sellAmount,
                minBuyAmount: minBuyAmount,
                startTime: block.timestamp,
                endTime: block.timestamp + main.config().auctionPeriod,
                fate: fate,
                open: false
            })
        );
    }

    // Prepares an auction where *minBuyAmount* is the independent variable and *sellAmount* is dependent.
    // Returns false as the first parameter if the corresponding *sellAmount* is only dust.
    function _prepareTargetBuyAuction(
        uint256 minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 maxSellAmount,
        uint256 targetBuyAmount,
        Fate fate
    ) internal returns (bool, Auction.Info memory emptyAuction) {
        (bool worth, Auction.Info memory auction) = _prepareTargetSellAuction(
            minAuctionSize,
            sell,
            buy,
            maxSellAmount,
            fate
        );
        if (!worth) {
            return (false, emptyAuction);
        }

        if (auction.minBuyAmount > targetBuyAmount) {
            auction.minBuyAmount = targetBuyAmount;

            uint256 exactSellAmount = (auction.minBuyAmount * buy.priceUSD(main)) / sell.priceUSD(main);
            auction.sellAmount = (exactSellAmount * SCALE) / (SCALE - main.config().maxTradeSlippage);
            assert(auction.sellAmount < maxSellAmount);

            uint256 rTokenMarketCapUSD = (main.rTokenAsset().priceUSD(main) * main.rToken().totalSupply()) / SCALE;
            uint256 minSellUSD = (rTokenMarketCapUSD * minAuctionSize) / SCALE;

            if (auction.sellAmount < (minSellUSD * SCALE) / sell.priceUSD(main)) {
                return (false, emptyAuction);
            }
        }

        return (true, auction);
    }
}
