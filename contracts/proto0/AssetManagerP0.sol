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
 * @notice Handles the transfer and trade of assets.
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
    // base factor = b = _meltingFactor / _basketDilutionFactor
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    uint256 internal _historicalBasketDilution = 1e18; // the product of all historical basket dilutions
    uint256 internal _prevBasketValue; // redemption value of the basket in fiatcoins last update

    EnumerableSet.AddressSet internal _approvedCollateral;
    EnumerableSet.AddressSet internal _alltimeCollateral;
    EnumerableSet.AddressSet internal _fiatcoins;

    IMain public main;
    IVault public override vault;

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
        _prevBasketValue = vault.basketRate();

        for (uint256 i = 0; i < approvedAssets_.length; i++) {
            _approveAsset(approvedAssets_[i]);
        }

        if (!vault.containsOnly(_approvedCollateral.values())) {
            revert CommonErrors.UnapprovedAsset();
        }

        _accumulate();

        main.rsr().approve(address(main.stRSR()), type(uint256).max);
        _transferOwnership(owner_);
    }

    modifier sideEffects() {
        main.furnace().doBurn();
        vault.updateCompoundAaveRates();
        _;
    }

    function update() external override sideEffects {}

    // Pulls BUs over from Main and mints RToken to the issuer. Called at the end of SlowIssuance.
    function issue(SlowIssuance memory issuance) external override sideEffects {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        issuance.vault.pullBUs(address(main), issuance.BUs); // Main should have set an allowance
        main.rToken().mint(issuance.issuer, issuance.amount);
    }

    // Transfers collateral to the redeemers account at the current BU exchange rate.
    function redeem(address redeemer, uint256 amount) external override sideEffects {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        main.rToken().burn(redeemer, amount);
        _oldestVault().redeem(redeemer, toBUs(amount));
    }

    // Claims COMP + AAVE from Vault + Manager and expands the RToken supply.
    function collectRevenue() external override sideEffects {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        vault.claimAndSweepRewardsToManager();
        main.comptroller().claimComp(address(this));
        IStaticAToken(address(main.aaveAsset().erc20())).claimRewardsToSelf(true);

        // Expand the RToken supply to self
        uint256 possible = fromBUs(vault.basketUnits(address(this)));
        if (fullyCapitalized() && possible > main.rToken().totalSupply()) {
            main.rToken().mint(address(this), possible - main.rToken().totalSupply());
        }
    }

    // Unapproves the defaulting asset and switches the RToken over to a new Vault.
    function switchVaults(IAsset[] memory defaulting) external override sideEffects {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        for (uint256 i = 0; i < defaulting.length; i++) {
            _unapproveAsset(defaulting[i]);
        }

        IVault newVault = main.monitor().getNextVault(vault, _approvedCollateral.values(), _fiatcoins.values());
        if (address(newVault) != address(0)) {
            _switchVault(newVault);
        }
    }

    // Upon vault change or change to *f*, we accumulate the historical dilution factor.
    function accumulate() external override sideEffects {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        _accumulate();
    }

    // Central auction loop:
    //    1. Closeout running auctions
    //    2. Create new BUs from collateral
    //    3. Break apart old BUs and trade toward new basket
    //    4. Run revenue auctions
    function doAuctions() external override sideEffects returns (State) {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        // Closeout open auctions or sleep if they are still ongoing.
        for (uint256 i = 0; i < auctions.length; i++) {
            Auction.Info storage auction = auctions[i];
            if (auction.isOpen) {
                if (block.timestamp <= auction.endTime) {
                    return State.TRADING;
                }

                uint256 boughtAmount = auction.close(main);
                if (!auction.clearedCloseToOraclePrice(main, boughtAmount)) {
                    return State.PRECAUTIONARY;
                }
            }
        }

        // Create new BUs
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            vault.issue(address(this), issuable);
        }

        // Recapitalization auctions (break apart old BUs)
        if (!fullyCapitalized()) {
            return _doRecapitalizationAuctions();
        }
        return _doRevenueAuctions();
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

    function fullyCapitalized() public view override returns (bool) {
        return vault.basketUnits(address(this)) >= toBUs(main.rToken().totalSupply());
    }

    function approvedFiatcoinAssets() external view override returns (address[] memory) {
        return _fiatcoins.values();
    }

    // RToken -> BUs
    function toBUs(uint256 amount) public view override returns (uint256) {
        if (main.rToken().totalSupply() == 0) {
            return amount;
        }
        return (amount * _basketDilutionFactor()) / _meltingFactor();
    }

    // BUs -> RToken
    function fromBUs(uint256 amount) public view override returns (uint256) {
        if (main.rToken().totalSupply() == 0) {
            return amount;
        }
        return (amount * _meltingFactor()) / _basketDilutionFactor();
    }

    //

    // base factor: numerator
    function _meltingFactor() internal view returns (uint256) {
        uint256 totalBurnt = main.furnace().totalBurnt();
        return (SCALE * (main.rToken().totalSupply() + totalBurnt)) / main.rToken().totalSupply();
    }

    // base factor: denominator
    function _basketDilutionFactor() internal view returns (uint256) {
        uint256 currentRate = vault.basketRate();
        uint256 currentDilution = SCALE + main.config().f * ((SCALE * currentRate) / _prevBasketValue - SCALE);
        return _historicalBasketDilution * currentDilution;
    }

    // Returns the oldest vault that contains nonzero BUs.
    // Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    // contains no asset tokens.
    function _oldestVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    //

    // Internal helper that runs infrequently to accumulate the historical dilution factor.
    function _accumulate() internal {
        _historicalBasketDilution = _basketDilutionFactor();
        _prevBasketValue = vault.basketRate();
    }

    function _switchVault(IVault vault_) internal {
        pastVaults.push(vault_);
        vault = vault_;

        // Accumulate the basket dilution factor to enable correct forward accounting
        _accumulate();
    }

    function _approveAsset(IAsset asset) internal {
        _approvedCollateral.add(address(asset));
        _alltimeCollateral.add(address(asset));
        if (asset.isFiatcoin()) {
            _fiatcoins.add(address(asset));
        }
    }

    function _unapproveAsset(IAsset asset) internal {
        _approvedCollateral.remove(address(asset));
        if (asset.isFiatcoin()) {
            _fiatcoins.remove(address(asset));
        }
    }

    function _launchAuction(Auction.Info memory auction) internal returns (State) {
        auctions.push(auction);
        auctions[auctions.length - 1].open();
        return State.TRADING;
    }

    // Inner portion of `runAuction()` loop pt 1
    function _doRecapitalizationAuctions() internal returns (State) {
        // Are we able to trade sideways, or is it all dust?
        (IAsset sell, IAsset buy, uint256 maxSell, uint256 targetBuy) = _largestCollateralForCollateralTrade();
        (bool trade, Auction.Info memory auction) = _prepareAuctionBuy(
            main.config().minRecapitalizationAuctionSize,
            sell,
            buy,
            maxSell,
            targetBuy,
            Fate.Stay
        );
        if (trade) {
            return _launchAuction(auction);
        }

        // Redeem BUs to open up spare collateral assets
        uint256 totalSupply = main.rToken().totalSupply();
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            uint256 max = toBUs(((totalSupply) * main.config().migrationChunk) / SCALE);
            uint256 chunk = Math.min(max, oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);
        }

        // Re-check the sideways trade
        (sell, buy, maxSell, targetBuy) = _largestCollateralForCollateralTrade();
        (trade, auction) = _prepareAuctionBuy(
            main.config().minRecapitalizationAuctionSize,
            sell,
            buy,
            maxSell,
            targetBuy,
            Fate.Stay
        );
        if (trade) {
            return _launchAuction(auction);
        }

        // Fallback to seizing RSR stake
        if (main.rsr().balanceOf(address(main.stRSR())) > 0) {
            // Recapitalization: RSR -> RToken
            (trade, auction) = _prepareAuctionBuy(
                main.config().minRecapitalizationAuctionSize,
                main.rsrAsset(),
                main.rTokenAsset(),
                main.rsr().balanceOf(address(main.stRSR())),
                totalSupply - fromBUs(vault.basketUnits(address(this))),
                Fate.Burn
            );

            if (trade) {
                main.stRSR().seizeRSR(auction.sellAmount - main.rsr().balanceOf(address(this)));
                return _launchAuction(auction);
            }
        }

        // The ultimate endgame: a haircut for RToken holders.
        _accumulate();
        uint256 melting = (SCALE * (totalSupply + main.furnace().totalBurnt())) / totalSupply;
        _historicalBasketDilution = (melting * vault.basketUnits(address(this))) / totalSupply;
        return State.CALM;
    }

    // Inner portion of `runAuction()` loop pt 2
    function _doRevenueAuctions() internal returns (State) {
        uint256 auctionLenSnapshot = auctions.length;

        // Empty oldest vault
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            oldVault.redeem(address(this), oldVault.basketUnits(address(this)));
        }

        // RToken -> dividend RSR
        (bool launch, Auction.Info memory auction) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.rTokenAsset(),
            main.rsrAsset(),
            main.rToken().balanceOf(address(this)),
            Fate.Stake
        );
        if (launch) {
            _launchAuction(auction);
        }

        // COMP -> dividend RSR + melting RToken
        uint256 amountForRSR = (main.compAsset().erc20().balanceOf(address(this)) * main.config().f) / SCALE;
        uint256 amountForRToken = main.compAsset().erc20().balanceOf(address(this)) - amountForRSR;
        (launch, auction) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.compAsset(),
            main.rsrAsset(),
            amountForRSR,
            Fate.Stake
        );
        (bool launch2, Auction.Info memory auction2) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.compAsset(),
            main.rTokenAsset(),
            amountForRToken,
            Fate.Melt
        );

        if (launch && launch2) {
            _launchAuction(auction);
            _launchAuction(auction2);
        }

        // AAVE -> dividend RSR + melting RToken
        amountForRSR = (main.aaveAsset().erc20().balanceOf(address(this)) * main.config().f) / SCALE;
        amountForRToken = main.aaveAsset().erc20().balanceOf(address(this)) - amountForRSR;
        (launch, auction) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.aaveAsset(),
            main.rsrAsset(),
            amountForRSR,
            Fate.Stake
        );
        (launch2, auction2) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.aaveAsset(),
            main.rTokenAsset(),
            amountForRToken,
            Fate.Melt
        );

        if (launch && launch2) {
            _launchAuction(auction);
            _launchAuction(auction2);
        }

        return auctions.length == auctionLenSnapshot ? State.CALM : State.TRADING;
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
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            IAsset a = IAsset(_alltimeCollateral.at(i));
            totalValue += IERC20(a.erc20()).balanceOf(address(this)) * a.priceUSD(main);
        }
        uint256 BUTarget = (totalValue * SCALE) / vault.basketRate();

        // Calculate surplus and deficits relative to the BU target.
        uint256[] memory surplus = new uint256[](_alltimeCollateral.length());
        uint256[] memory deficit = new uint256[](_alltimeCollateral.length());
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            IAsset a = IAsset(_alltimeCollateral.at(i));
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
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            if (surplus[i] > surplusMax) {
                surplusMax = surplus[i];
                sellIndex = i;
            }
            if (deficit[i] > deficitMax) {
                deficitMax = deficit[i];
                buyIndex = i;
            }
        }

        IAsset sell = IAsset(_alltimeCollateral.at(sellIndex));
        IAsset buy = IAsset(_alltimeCollateral.at(buyIndex));
        uint256 maxSellAmount = (surplusMax * SCALE) / sell.priceUSD(main);
        uint256 buyAmount = (deficitMax * SCALE) / buy.priceUSD(main);
        return (sell, buy, maxSellAmount, buyAmount);
    }

    // Prepares an auction where *sellAmount* is the independent variable and *minBuyAmount* is dependent.
    // Returns false as the first parameter if *sellAmount* is only dust.
    function _prepareAuctionSell(
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
                isOpen: false
            })
        );
    }

    // Prepares an auction where *minBuyAmount* is the independent variable and *sellAmount* is dependent.
    // Returns false as the first parameter if the corresponding *sellAmount* is only dust.
    function _prepareAuctionBuy(
        uint256 minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 maxSellAmount,
        uint256 targetBuyAmount,
        Fate fate
    ) internal returns (bool, Auction.Info memory emptyAuction) {
        (bool trade, Auction.Info memory auction) = _prepareAuctionSell(minAuctionSize, sell, buy, maxSellAmount, fate);
        if (!trade) {
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
