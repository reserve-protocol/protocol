// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/proto0/libraries/Auction.sol";
import "contracts/proto0/interfaces/IAsset.sol";
import "contracts/proto0/interfaces/IAssetManager.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/interfaces/IRToken.sol";
import "contracts/proto0/interfaces/IVault.sol";
import "contracts/proto0/FurnaceP0.sol";
import "contracts/proto0/RTokenP0.sol";
import "contracts/proto0/StRSRP0.sol";
import "contracts/libraries/CommonErrors.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title AssetManagerP0
 * @notice Handles the transfer and trade of assets
 *    - Defines the exchange rate between Vault BUs and RToken supply, via the base factor
 *    - Manages RToken backing via a Vault
 *    - Runs recapitalization and revenue auctions
 */
contract AssetManagerP0 is IAssetManager, Ownable {
    using SafeERC20 for IERC20;
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;
    using Oracle for Oracle.Info;
    using FixLib for Fix;

    // ECONOMICS
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingFactor / _basketDilutionFactor
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    Fix internal _historicalBasketDilution; // the product of all historical basket dilutions
    Fix internal _prevBasketRate; // redemption value of the basket in fiatcoins last update

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
        ICollateral[] memory approvedCollateral_
    ) {
        main = main_;
        vault = vault_;

        for (uint256 i = 0; i < approvedCollateral_.length; i++) {
            _approveCollateral(approvedCollateral_[i]);
        }

        if (!vault.containsOnly(_approvedCollateral.values())) {
            revert CommonErrors.UnapprovedCollateral();
        }

        main.rsr().approve(address(main.stRSR()), type(uint256).max);
        _prevBasketRate = vault.basketRate();
        _historicalBasketDilution = FIX_ONE;
        _transferOwnership(owner_);
    }

    /// Mints `issuance.amount` of RToken to `issuance.minter`
    /// @dev Requires caller BU allowance
    function issue(SlowIssuance memory issuance) external override {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        require(!issuance.processed, "already processed");
        issuance.vault.pullBUs(address(main), issuance.BUs); // Main should have set an allowance
        main.rToken().mint(issuance.issuer, issuance.amount);
    }

    /// Redeems `amount` {RTok} to `redeemer`
    function redeem(address redeemer, uint256 amount) external override {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        main.rToken().burn(redeemer, amount);
        _oldestVault().redeem(redeemer, toBUs(amount));
    }

    /// Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function collectRevenue() external override {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        vault.claimAndSweepRewardsToManager();
        main.comptroller().claimComp(address(this));
        for (uint256 i = 0; i < vault.size(); i++) {
            // Only aTokens need to be claimed at the collateral level
            vault.collateralAt(i).claimRewards();
        }
        // Expand the RToken supply to self
        uint256 possible = fromBUs(vault.basketUnits(address(this)));
        uint256 totalSupply = main.rToken().totalSupply();
        if (fullyCapitalized() && possible > totalSupply) {
            main.rToken().mint(address(this), possible - totalSupply);
        }
    }

    /// Attempts to switch vaults to a backup vault that does not contain `defaulting` collateral
    function switchVaults(ICollateral[] memory defaulting) external override {
        require(_msgSender() == address(main), "only main can mutate the asset manager");

        for (uint256 i = 0; i < defaulting.length; i++) {
            _unapproveAsset(defaulting[i]);
        }

        IVault newVault = main.monitor().getNextVault(vault, _approvedCollateral.values(), _fiatcoins.values());
        if (address(newVault) != address(0)) {
            _switchVault(newVault);
        }
    }

    /// Accumulates current metrics into historical metrics
    function accumulate() external override {
        require(_msgSender() == address(main), "only main can mutate the asset manager");
        _accumulate();
    }

    /// Performs any and all auctions in the system
    /// @return The current enum `State`
    function doAuctions() external override returns (State) {
        // Outline:
        //  1. Closeout running auctions
        //  2. Create new BUs from collateral
        //  3. Break apart old BUs and trade toward new basket
        //  4. Run revenue auctions

        require(_msgSender() == address(main), "only main can mutate the asset manager");
        // Closeout open auctions or sleep if they are still ongoing.
        for (uint256 i = 0; i < auctions.length; i++) {
            Auction.Info storage auction = auctions[i];
            if (auction.isOpen) {
                if (block.timestamp <= auction.endTime) {
                    return State.TRADING;
                }
                auction.close(main);
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

    function approveCollateral(ICollateral collateral) external onlyOwner {
        _approveCollateral(collateral);
    }

    function unapproveCollateral(ICollateral collateral) external onlyOwner {
        _unapproveAsset(collateral);
    }

    function switchVault(IVault vault_) external onlyOwner {
        _switchVault(vault_);
    }

    //

    /// @return Whether the vault is fully capitalized
    function fullyCapitalized() public view override returns (bool) {
        return vault.basketUnits(address(this)) >= main.rToken().totalSupply();
    }

    /// @return fiatcoins An array of approved fiatcoin collateral to be used for oracle USD determination
    function approvedFiatcoins() external view override returns (ICollateral[] memory fiatcoins) {
        address[] memory addresses = _fiatcoins.values();
        fiatcoins = new ICollateral[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            fiatcoins[i] = ICollateral(addresses[i]);
        }
    }

    /// @return {qRTok/qBU} The base factor
    function baseFactor() public override returns (Fix) {
        main.furnace().doBurn();
        return _meltingFactor().div(_basketDilutionFactor());
    }

    /// {qRTok} -> {qBU}
    function toBUs(uint256 amount) public override returns (uint256) {
        if (main.rToken().totalSupply() == 0) {
            return amount;
        }

        // (_basketDilutionFactor() / _meltingFactor()) * amount
        return toFix(amount).div(baseFactor()).toUint();
    }

    /// {qBU} -> {qRTok}
    // solhint-disable-next-line func-param-name-mixedcase
    function fromBUs(uint256 BUs) public override returns (uint256) {
        if (main.rToken().totalSupply() == 0) {
            return BUs;
        }

        // (_meltingFactor() / _basketDilutionFactor()) * BUs
        return baseFactor().mulu(BUs).toUint();
    }

    //

    /// @return {none} Numerator of the base factor
    function _meltingFactor() internal view returns (Fix) {
        Fix totalSupply = toFix(main.rToken().totalSupply()); // {RTok}
        Fix totalBurnt = toFix(main.furnace().totalBurnt()); // {RTok}
        if (totalSupply.eq(FIX_ZERO)) {
            return FIX_ONE;
        }

        // (totalSupply + totalBurnt) / totalSupply
        return totalSupply.plus(totalBurnt).div(totalSupply);
    }

    /// @return {none) Denominator of the base factor
    function _basketDilutionFactor() internal returns (Fix) {
        Fix currentRate = vault.basketRate();

        // currentDilution = (f * ((currentRate / _prevBasketRate) - 1)) + 1
        Fix currentDilution = main.config().f.mul(currentRate.div(_prevBasketRate).minus(FIX_ONE)).plus(FIX_ONE);
        return _historicalBasketDilution.mul(currentDilution);
    }

    /// Returns the oldest vault that contains nonzero BUs.
    /// Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    /// contains no collateral.
    function _oldestVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    //

    /// Runs infrequently to accumulate the historical dilution factor
    function _accumulate() internal {
        _historicalBasketDilution = _basketDilutionFactor();
        _prevBasketRate = vault.basketRate();
    }

    function _switchVault(IVault vault_) internal {
        pastVaults.push(vault_);
        emit NewVaultSet(address(vault), address(vault_));
        vault = vault_;

        // Accumulate the basket dilution factor to enable correct forward accounting
        _accumulate();
    }

    function _approveCollateral(ICollateral collateral) internal {
        _approvedCollateral.add(address(collateral));
        _alltimeCollateral.add(address(collateral));
        if (collateral.isFiatcoin()) {
            _fiatcoins.add(address(collateral));
        }
    }

    function _unapproveAsset(ICollateral collateral) internal {
        _approvedCollateral.remove(address(collateral));
        if (collateral.isFiatcoin()) {
            _fiatcoins.remove(address(collateral));
        }
    }

    /// Opens an `auction`
    function _launchAuction(Auction.Info memory auction) internal {
        auctions.push(auction);
        auctions[auctions.length - 1].open();
    }

    /// Runs all auctions for recapitalization
    function _doRecapitalizationAuctions() internal returns (State) {
        // Are we able to trade sideways, or is it all dust?
        (
            ICollateral sell,
            ICollateral buy,
            uint256 maxSell,
            uint256 targetBuy
        ) = _largestCollateralForCollateralTrade();
        (bool trade, Auction.Info memory auction) = _prepareAuctionBuy(
            main.config().minRecapitalizationAuctionSize,
            sell,
            buy,
            maxSell,
            _approvedCollateral.contains(address(sell)) ? targetBuy : 0,
            Fate.Stay
        );
        if (trade) {
            _launchAuction(auction);
            return State.TRADING;
        }

        // Redeem BUs to open up spare collateral
        uint256 totalSupply = main.rToken().totalSupply();
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            uint256 max = main.config().migrationChunk.mulu(totalSupply).toUint();
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
            _approvedCollateral.contains(address(sell)) ? targetBuy : 0,
            Fate.Stay
        );
        if (trade) {
            _launchAuction(auction);
            return State.TRADING;
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
                _launchAuction(auction);
                return State.TRADING;
            }
        }

        // The ultimate endgame: a haircut for RToken holders.
        _accumulate();
        Fix melting = (toFix(totalSupply).plusu(main.furnace().totalBurnt())).divu(totalSupply);
        _historicalBasketDilution = melting.mulu(vault.basketUnits(address(this))).divu(totalSupply);
        return State.CALM;
    }

    /// Runs all auctions for revenue
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
        Fix compBal = toFix(main.compAsset().erc20().balanceOf(address(this)));
        Fix amountForRSR = compBal.mul(main.config().f);
        Fix amountForRToken = compBal.minus(amountForRSR);
        (launch, auction) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.compAsset(),
            main.rsrAsset(),
            amountForRSR.toUint(),
            Fate.Stake
        );
        (bool launch2, Auction.Info memory auction2) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.compAsset(),
            main.rTokenAsset(),
            amountForRToken.toUint(),
            Fate.Melt
        );

        if (launch && launch2) {
            _launchAuction(auction);
            _launchAuction(auction2);
        }

        // AAVE -> dividend RSR + melting RToken
        Fix aaveBal = toFix(main.compAsset().erc20().balanceOf(address(this)));
        amountForRSR = aaveBal.mul(main.config().f);
        amountForRToken = aaveBal.minus(amountForRSR);
        (launch, auction) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.aaveAsset(),
            main.rsrAsset(),
            amountForRSR.toUint(),
            Fate.Stake
        );
        (launch2, auction2) = _prepareAuctionSell(
            main.config().minRevenueAuctionSize,
            main.aaveAsset(),
            main.rTokenAsset(),
            amountForRToken.toUint(),
            Fate.Melt
        );

        if (launch && launch2) {
            _launchAuction(auction);
            _launchAuction(auction2);
        }

        return auctions.length == auctionLenSnapshot ? State.CALM : State.TRADING;
    }

    /// Determines what the largest collateral-for-collateral trade is.
    /// Algorithm:
    ///    1. Target a particular number of basket units based on total fiatcoins held across all collateral.
    ///    2. Choose the most in-surplus and most in-deficit collateral assets for trading.
    /// @return Sell collateral
    /// @return Buy collateral
    /// @return {sellTokLot} Sell amount
    /// @return {buyTokLot} Buy amount
    function _largestCollateralForCollateralTrade()
        internal
        returns (
            ICollateral,
            ICollateral,
            uint256,
            uint256
        )
    {
        // Calculate a BU target (if we could trade with 0 slippage)
        Fix totalValue; // {attoUSD}
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            ICollateral a = ICollateral(_alltimeCollateral.at(i));
            Fix bal = toFix(IERC20(a.erc20()).balanceOf(address(this)));

            // {attoUSD} = {attoUSD} + {attoUSD/qTok} * {qTok}
            totalValue = totalValue.plus(a.priceUSD(main).mul(bal));
        }
        // {BU} = {attoUSD} / {attoUSD/BU}
        Fix BUTarget = totalValue.div(vault.basketRate());

        // Calculate surplus and deficits relative to the BU target.
        Fix[] memory surplus = new Fix[](_alltimeCollateral.length());
        Fix[] memory deficit = new Fix[](_alltimeCollateral.length());
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            ICollateral a = ICollateral(_alltimeCollateral.at(i));
            Fix bal = toFix(IERC20(a.erc20()).balanceOf(address(this))); // {qTok}

            // {qTok} = {BU} * {qTok/BU}
            Fix target = BUTarget.mulu(vault.quantity(a));
            if (bal.gt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surplus[i] = bal.minus(target).mul(a.priceUSD(main));
            } else if (bal.lt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficit[i] = target.minus(bal).mul(a.priceUSD(main));
            }
        }

        // Calculate the maximums.
        uint256 sellIndex;
        uint256 buyIndex;
        Fix surplusMax; // {attoUSD}
        Fix deficitMax; // {attoUSD}
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            if (surplus[i].gt(surplusMax)) {
                surplusMax = surplus[i];
                sellIndex = i;
            }
            if (deficit[i].gt(deficitMax)) {
                deficitMax = deficit[i];
                buyIndex = i;
            }
        }

        ICollateral sell = ICollateral(_alltimeCollateral.at(sellIndex));
        ICollateral buy = ICollateral(_alltimeCollateral.at(buyIndex));

        // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
        Fix sellAmount = surplusMax.div(sell.priceUSD(main));

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(buy.priceUSD(main));
        return (sell, buy, sellAmount.toUint(), buyAmount.toUint());
    }

    /// Prepares an auction where *sellAmount* is the independent variable and *minBuyAmount* is dependent.
    /// @param minAuctionSize {none}
    /// @param sellAmount {qSellTok}
    /// @return false if it is a dust trade
    function _prepareAuctionSell(
        Fix minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 sellAmount,
        Fate fate
    ) internal returns (bool, Auction.Info memory auction) {
        sellAmount = Math.min(sellAmount, sell.erc20().balanceOf(address(this)));

        // {attoUSD} = {attoUSD/qSellTok} * {qSellTok}
        Fix rTokenMarketCapUSD = main.rTokenAsset().priceUSD(main).mulu(main.rToken().totalSupply());
        Fix maxSellUSD = rTokenMarketCapUSD.mul(main.config().maxAuctionSize); // {attoUSD}
        Fix minSellUSD = rTokenMarketCapUSD.mul(minAuctionSize); // {attoUSD}

        // {qSellTok} < {attoUSD} / {attoUSD/qSellTok}
        if (sellAmount < minSellUSD.div(sell.priceUSD(main)).toUint()) {
            return (false, auction);
        }

        sellAmount = Math.min(sellAmount, maxSellUSD.div(sell.priceUSD(main)).toUint()); // {qSellTok}
        Fix exactBuyAmount = toFix(sellAmount).mul(sell.priceUSD(main)).div(buy.priceUSD(main)); // {qBuyTok}
        Fix minBuyAmount = exactBuyAmount.minus(exactBuyAmount.mul(main.config().maxTradeSlippage)); // {qBuyTok}
        return (
            true,
            Auction.Info({
                sell: sell,
                buy: buy,
                sellAmount: sellAmount,
                minBuyAmount: minBuyAmount.toUint(),
                startTime: block.timestamp,
                endTime: block.timestamp + main.config().auctionPeriod,
                fate: fate,
                isOpen: false
            })
        );
    }

    /// Prepares an auction where *minBuyAmount* is the independent variable and *sellAmount* is dependent.
    /// @param maxSellAmount {qSellTok}
    /// @param targetBuyAmount {qBuyTok}
    /// @return false if it is a dust trade
    function _prepareAuctionBuy(
        Fix minAuctionSize,
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

            // {qSellTok} = {qBuyTok} * {attoUSD/qBuyTok} / {attoUSD/qSellTok}
            Fix exactSellAmount = toFix(auction.minBuyAmount).mul(buy.priceUSD(main)).div(sell.priceUSD(main));

            // {qSellTok} = {qSellTok} / {none}
            auction.sellAmount = exactSellAmount.div(FIX_ONE.minus(main.config().maxTradeSlippage)).toUint();
            assert(auction.sellAmount < maxSellAmount);

            // {attoUSD} = {attoUSD/qRTok} * {qRTok}
            Fix rTokenMarketCapUSD = main.rTokenAsset().priceUSD(main).mulu(main.rToken().totalSupply());
            Fix minSellUSD = rTokenMarketCapUSD.mul(minAuctionSize);

            // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
            uint256 minSellAmount = minSellUSD.div(sell.priceUSD(main)).toUint();
            if (auction.sellAmount < minSellAmount) {
                return (false, emptyAuction);
            }
        }

        return (true, auction);
    }
}
