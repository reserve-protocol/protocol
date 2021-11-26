pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/assets/collateral/ATokenCollateralP0.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/assets/RTokenAssetP0.sol";
import "contracts/p0/assets/RSRAssetP0.sol";
import "contracts/p0/assets/AAVEAssetP0.sol";
import "contracts/p0/assets/COMPAssetP0.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IAssetManager.sol";
import "contracts/p0/interfaces/IDefaultMonitor.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "contracts/p0/FurnaceP0.sol";
import "contracts/p0/RTokenP0.sol";
import "contracts/p0/StRSRP0.sol";
import "contracts/libraries/CommonErrors.sol";

/**
 * @title MainP0
 * @notice The central coordinator for the entire system, as well as the external interface.
 */

// solhint-disable max-states-count
contract MainP0 is IMain, Pausable {
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using Oracle for Oracle.Info;
    using SafeERC20 for IERC20;

    // ECONOMICS
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingFactor() / _basketDilutionFactor()
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    Fix internal _historicalBasketDilution; // the product of all historical basket dilutions
    Fix internal _prevBasketRate; // redemption value of the basket in fiatcoins last update

    EnumerableSet.AddressSet internal _approvedCollateral;
    EnumerableSet.AddressSet internal _alltimeCollateral;
    EnumerableSet.AddressSet internal _fiatcoins;

    IVault public override vault;
    IMarket public market;

    IVault[] public pastVaults;
    Auction.Info[] public auctions;

    //

    Config internal _config;
    Oracle.Info internal _oracle;

    IFurnace public furnace;
    IStRSR public stRSR;
    IDefaultMonitor public monitor;

    // Assets
    IAsset public rTokenAsset;
    IAsset public rsrAsset;
    IAsset public compAsset;
    IAsset public aaveAsset;

    Fix public f; // TODO:

    // timestamp -> whether rewards have been claimed.
    mapping(uint256 => bool) private rewardsClaimed;

    // Slow Issuance
    SlowIssuance[] public issuances;

    // Default detection.
    Mood public override mood;
    uint256 public stateRaisedAt; // timestamp when default occurred

    constructor(
        Oracle.Info memory oracle_,
        Config memory config_,
        IVault vault_,
        IMarket market_,
        ICollateral[] memory approvedCollateral_
    ) {
        _oracle = oracle_;
        _config = config_;
        f = config_.f; // TODO
        vault = vault_;
        market = market_;

        for (uint256 i = 0; i < approvedCollateral_.length; i++) {
            _approveCollateral(approvedCollateral_[i]);
        }

        ICollateral[] memory c = new ICollateral[](_approvedCollateral.length());
        for (uint256 i = 0; i < c.length; i++) {
            c[i] = ICollateral(_approvedCollateral.at(i));
        }
        if (!vault.containsOnly(c)) {
            revert CommonErrors.UnapprovedCollateral();
        }

        rsrAsset.erc20().approve(address(stRSR), type(uint256).max);
        _prevBasketRate = vault.basketRate();
        _historicalBasketDilution = FIX_ONE;
    }

    /// This modifier runs before every function including redemption, so it should be very safe.
    modifier always() {
        furnace.doBurn();
        // TODO: Update compound?
        ICollateral[] memory hardDefaulting = monitor.checkForHardDefault(vault);
        if (hardDefaulting.length > 0) {
            _switchVault(hardDefaulting);
            mood = Mood.TRADING; // TODO
        }
        _;
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    function issue(uint256 amount) public override notPaused always {
        require(mood == Mood.CALM || mood == Mood.TRADING, "only during calm + trading");
        require(amount > 0, "Cannot issue zero");

        _processSlowIssuance();

        uint256 amtBUs = toBUs(amount);

        // During SlowIssuance, BUs are created up front and held by `Main` until the issuance vests,
        // at which point the BUs are transferred to the AssetManager and RToken is minted to the issuer.
        SlowIssuance memory iss = SlowIssuance({
            vault: vault,
            amount: amount,
            amtBUs: amtBUs,
            deposits: vault.tokenAmounts(amtBUs),
            issuer: _msgSender(),
            blockAvailableAt: _nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);

        for (uint256 i = 0; i < iss.vault.size(); i++) {
            IERC20(iss.vault.collateralAt(i).erc20()).safeTransferFrom(iss.issuer, address(this), iss.deposits[i]);
            IERC20(iss.vault.collateralAt(i).erc20()).safeApprove(address(iss.vault), iss.deposits[i]);
        }

        iss.vault.issue(address(this), iss.amtBUs);
        emit IssuanceStarted(issuances.length - 1, iss.issuer, iss.amount, iss.blockAvailableAt);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    function redeem(uint256 amount) public override always {
        require(amount > 0, "Cannot redeem zero");
        if (!paused) {
            _processSlowIssuance();
        }

        rToken().burn(_msgSender(), amount);
        _oldestVault().redeem(_msgSender(), toBUs(amount));
        emit Redemption(_msgSender(), amount);
    }

    /// Runs the central auction loop
    function poke() external override notPaused always {
        require(mood == Mood.CALM || mood == Mood.TRADING, "only during calm + trading");
        _processSlowIssuance();

        if (mood == Mood.CALM) {
            (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
            if (!rewardsClaimed[prevRewards]) {
                collectRevenue();
                rewardsClaimed[prevRewards] = true;
            }
        }

        doAuctions();
    }

    /// Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function collectRevenue() public {
        // TODO
        // vault.claimAndSweepRewardsToManager();
        // main.comptroller().claimComp(address(this));
        // for (uint256 i = 0; i < vault.size(); i++) {
        //     // Only aTokens need to be claimed at the collateral level
        //     if (vault.collateralAt(i).isAToken()) {
        //         IStaticAToken(address(vault.collateralAt(i).erc20())).claimRewardsToSelf(true);
        //     }
        // }
        // // Expand the RToken supply to self
        // uint256 possible = fromBUs(vault.basketUnits(address(this)));
        // uint256 totalSupply = rToken().totalSupply();
        // if (fullyCapitalized() && possible > totalSupply) {
        //     rToken().mint(address(this), possible - totalSupply);
        // }
    }

    /// Performs any and all auctions in the system
    function doAuctions() public {
        // Closeout open auctions or sleep if they are still ongoing.
        for (uint256 i = 0; i < auctions.length; i++) {
            Auction.Info storage auction = auctions[i];
            if (auction.isOpen) {
                if (block.timestamp <= auction.endTime) {
                    return;
                }
                auction.close(this, market, i);
            }
        }

        // Create new BUs
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            uint256[] memory amounts = vault.tokenAmounts(issuable);
            for (uint256 i = 0; i < amounts.length; i++) {
                vault.collateralAt(i).erc20().safeApprove(address(vault), amounts[i]);
            }
            vault.issue(address(this), issuable);
        }

        // Recapitalization auctions (break apart old BUs)
        Mood newMood;
        if (!fullyCapitalized()) {
            newMood = _doRecapitalizationAuctions();
        } else {
            newMood = _doRevenueAuctions();
        }

        if (newMood != mood) {
            emit MoodChanged(mood, newMood);
            mood = newMood;
        }
    }

    /// Performs the expensive checks for default, such as calculating VWAPs
    function noticeDefault() external override notPaused always {
        ICollateral[] memory softDefaulting = monitor.checkForSoftDefault(vault, approvedFiatcoins());

        // If no defaults, walk back the default and enter CALM/TRADING
        if (softDefaulting.length == 0) {
            Mood newMood = fullyCapitalized() ? Mood.CALM : Mood.TRADING;
            if (newMood != mood) {
                emit MoodChanged(mood, newMood);
                mood = newMood;
            }
            return;
        }

        // If mood is DOUBT for >24h (default delay), switch vaults
        if (mood == Mood.DOUBT && block.timestamp >= stateRaisedAt + _config.defaultDelay) {
            _switchVault(softDefaulting);
            emit MoodChanged(mood, Mood.TRADING);
            mood = Mood.TRADING;
        } else if (mood == Mood.CALM || mood == Mood.TRADING) {
            emit MoodChanged(mood, Mood.DOUBT);
            mood = Mood.DOUBT;
            stateRaisedAt = block.timestamp;
        }
    }

    /// @return Whether the vault is fully capitalized
    function fullyCapitalized() public view override returns (bool) {
        // TODO only BUs from outside slow issuance
        return fromBUs(vault.basketUnits(address(this))) >= rToken().totalSupply();
    }

    /// @return fiatcoins An array of approved fiatcoin collateral to be used for oracle USD determination
    // TODO: make `fiatcoins` storage instead of memory
    function approvedFiatcoins() public view returns (ICollateral[] memory fiatcoins) {
        address[] memory addresses = _approvedCollateral.values();
        uint256 size;
        for (uint256 i = 0; i < addresses.length; i++) {
            if (ICollateral(addresses[i]).isFiatcoin()) {
                size++;
            }
        }
        fiatcoins = new ICollateral[](size);
        size = 0;
        for (uint256 i = 0; i < addresses.length; i++) {
            if (ICollateral(addresses[i]).isFiatcoin()) {
                fiatcoins[size] = ICollateral(addresses[i]);
                size++;
            }
        }
    }

    function setConfig(Config memory config_) external override onlyOwner {
        // When f changes we need to accumulate the historical basket dilution
        // TODO
        if (f.neq(config_.f)) {
            _accumulate();
        }
        _config = config_;
        f = config_.f;
    }

    function setMonitor(IDefaultMonitor monitor_) external override onlyOwner {
        monitor = monitor_;
    }

    function setStRSR(IStRSR stRSR_) external override onlyOwner {
        stRSR = stRSR_;
    }

    function setFurnace(IFurnace furnace_) external override onlyOwner {
        furnace = furnace_;
    }

    function setOracle(Oracle.Info memory oracle) external override onlyOwner {
        _oracle = oracle;
    }

    function setRTokenAsset(IAsset rTokenAsset_) external override onlyOwner {
        rTokenAsset = rTokenAsset_;
    }

    function setRSRAsset(IAsset rsrAsset_) external override onlyOwner {
        rsrAsset = rsrAsset_;
    }

    function setCompAsset(IAsset compAsset_) external override onlyOwner {
        compAsset = compAsset_;
    }

    function setAaveAsset(IAsset aaveAsset_) external override onlyOwner {
        aaveAsset = aaveAsset_;
    }

    function approveCollateral(ICollateral collateral) external onlyOwner {
        _approveCollateral(collateral);
    }

    function unapproveCollateral(ICollateral collateral) external onlyOwner {
        _unapproveAsset(collateral);
    }

    function switchVault(IVault vault_) external override onlyOwner {
        _switchVault(vault_);
    }

    // ==================================== Views ====================================

    /// {qRTok} -> {qBU}
    function toBUs(uint256 amount) public view returns (uint256) {
        if (rToken().totalSupply() == 0) {
            return amount;
        }

        // (_meltingFactor() / _basketDilutionFactor()) * amtBUs
        return _baseFactor().mulu(amount).toUint();
    }

    /// {qBU} -> {qRTok}
    function fromBUs(uint256 amtBUs) public view returns (uint256) {
        if (rToken().totalSupply() == 0) {
            return amtBUs;
        }

        // (_basketDilutionFactor() / _meltingFactor()) * amount
        return toFix(amtBUs).div(_baseFactor()).toUint();
    }

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _rewardsAdjacent(block.timestamp);
        return next;
    }

    /// @return The token quantities required to issue `amount` RToken.
    function quote(uint256 amount) public view override returns (uint256[] memory) {
        return vault.tokenAmounts(toBUs(amount));
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() public view override returns (address[] memory erc20s) {
        erc20s = new address[](vault.size());
        for (uint256 i = 0; i < vault.size(); i++) {
            erc20s[i] = address(vault.collateralAt(i).erc20());
        }
    }

    /// @return {attoUSD/qTok} The price in attoUSD of a `qTok` on oracle `source`.
    function consultOracle(Oracle.Source source, address token) public view override returns (Fix) {
        return _oracle.consult(source, token);
    }

    /// @return The RToken deployment
    function rToken() public view override returns (IRToken) {
        return IRToken(address(rTokenAsset.erc20()));
    }

    /// @return The RSR deployment
    function rsr() public view override returns (IERC20) {
        return rsrAsset.erc20();
    }

    //TODO: Delete
    function config() external view override returns (Config memory) {
        return _config;
    }

    // ==================================== Internal ====================================
    // TODO: Remove

    function defaultThreshold() external view override returns (Fix) {
        return _config.defaultThreshold;
    }

    function stRSRWithdrawalDelay() external view override returns (uint256) {
        return _config.stRSRWithdrawalDelay;
    }

    //

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

    function _switchVault(ICollateral[] memory defaulting) internal {
        ICollateral[] memory c = new ICollateral[](_approvedCollateral.length());
        for (uint256 i = 0; i < c.length; i++) {
            c[i] = ICollateral(_approvedCollateral.at(i));
        }
        _switchVault(monitor.getNextVault(vault, c, approvedFiatcoins()));
    }

    function _switchVault(IVault vault_) internal {
        pastVaults.push(vault);
        emit NewVaultSet(address(vault), address(vault_));
        vault = vault_;

        // Accumulate the basket dilution factor to enable correct forward accounting
        _accumulate();
    }

    /// Runs infrequently to accumulate the historical dilution factor
    function _accumulate() internal {
        _historicalBasketDilution = _basketDilutionFactor();
        _prevBasketRate = vault.basketRate();
    }

    /// @return {qBU/qRTok} The base factor
    function _baseFactor() internal view returns (Fix) {
        return _meltingFactor().div(_basketDilutionFactor());
    }

    /// @return {none) Denominator of the base factor
    function _basketDilutionFactor() internal view returns (Fix) {
        Fix currentRate = vault.basketRate();

        // Assumption: Defi redemption rates are monotonically increasing
        Fix delta = currentRate.minus(_prevBasketRate);

        // r = p2 / (p1 + (p2-p1) * (1-f))
        Fix r = currentRate.div(_prevBasketRate.plus(delta.mul(FIX_ONE.minus(f))));
        Fix dilutionFactor = _historicalBasketDilution.mul(r);
        require(dilutionFactor.gt(FIX_ZERO), "dilutionFactor cannot be zero");
        return dilutionFactor;
    }

    /// @return {none} Numerator of the base factor
    function _meltingFactor() internal view returns (Fix) {
        Fix totalSupply = toFix(rToken().totalSupply()); // {RTok}
        Fix totalBurnt = toFix(furnace.totalBurnt()); // {RTok}
        if (totalSupply.eq(FIX_ZERO)) {
            return FIX_ONE;
        }

        // (totalSupply + totalBurnt) / totalSupply
        return totalSupply.plus(totalBurnt).div(totalSupply);
    }

    /// Returns the oldest vault that contains nonzero BUs.
    /// Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    /// contains no collateral._oldestVault()
    function _oldestVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    // Returns the future block number at which an issuance for *amount* now can complete
    function _nextIssuanceBlockAvailable(uint256 amount) internal view returns (uint256) {
        uint256 perBlock = Math.max(
            10_000 * 10**rTokenAsset.decimals(), // lower-bound: 10k whole RToken per block
            toFix(rTokenAsset.erc20().totalSupply()).mul(_config.issuanceRate).toUint()
        ); // {RToken/block}
        uint256 blockStart = issuances.length == 0 ? block.number : issuances[issuances.length - 1].blockAvailableAt;
        return Math.max(blockStart, block.number) + Math.ceilDiv(amount, perBlock);
    }

    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuances.length; i++) {
            if (!issuances[i].processed && issuances[i].vault != vault) {
                issuances[i].vault.redeem(issuances[i].issuer, issuances[i].amtBUs);
                issuances[i].processed = true;
                emit IssuanceCanceled(i);
            } else if (!issuances[i].processed && issuances[i].blockAvailableAt <= block.number) {
                // TODO: Tracking two sets of BUs
                rToken().mint(issuances[i].issuer, issuances[i].amount);
                issuances[i].processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }

    // Returns the rewards boundaries on either side of *time*.
    function _rewardsAdjacent(uint256 time) internal view returns (uint256 left, uint256 right) {
        int256 reps = (int256(time) - int256(_config.rewardStart)) / int256(_config.rewardPeriod);
        left = uint256(reps * int256(_config.rewardPeriod) + int256(_config.rewardStart));
        right = left + _config.rewardPeriod;
    }

    // ========= Auctioneer =============================

    /// Opens an `auction`
    function _launchAuction(Auction.Info memory auction) internal {
        auctions.push(auction);
        auctions[auctions.length - 1].open(this, market, auctions.length - 1);
    }

    /// Runs all auctions for recapitalization
    function _doRecapitalizationAuctions() internal returns (Mood) {
        // Are we able to trade sideways, or is it all dust?
        (
            ICollateral sell,
            ICollateral buy,
            uint256 maxSell,
            uint256 targetBuy
        ) = _largestCollateralForCollateralTrade();

        (bool trade, Auction.Info memory auction) = _prepareAuctionBuy(
            _config.minRecapitalizationAuctionSize,
            sell,
            buy,
            maxSell,
            _approvedCollateral.contains(address(sell)) ? targetBuy : 0,
            Fate.Stay
        );

        if (trade) {
            _launchAuction(auction);
            return Mood.TRADING;
        }

        // Redeem BUs to open up spare collateral
        uint256 totalSupply = rToken().totalSupply();
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            uint256 max = _config.migrationChunk.mulu(totalSupply).toUint();
            uint256 chunk = Math.min(max, oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);
        }

        // Re-check the sideways trade
        (sell, buy, maxSell, targetBuy) = _largestCollateralForCollateralTrade();
        (trade, auction) = _prepareAuctionBuy(
            _config.minRecapitalizationAuctionSize,
            sell,
            buy,
            maxSell,
            _approvedCollateral.contains(address(sell)) ? targetBuy : 0,
            Fate.Stay
        );

        if (trade) {
            _launchAuction(auction);
            return Mood.TRADING;
        }

        // Fallback to seizing RSR stake
        if (rsr().balanceOf(address(stRSR)) > 0) {
            // Recapitalization: RSR -> RToken
            (trade, auction) = _prepareAuctionBuy(
                _config.minRecapitalizationAuctionSize,
                rsrAsset,
                rTokenAsset,
                rsr().balanceOf(address(stRSR)),
                totalSupply - fromBUs(vault.basketUnits(address(this))),
                Fate.Burn
            );

            if (trade) {
                stRSR.seizeRSR(auction.sellAmount - rsr().balanceOf(address(this)));
                _launchAuction(auction);
                return Mood.TRADING;
            }
        }

        // The ultimate endgame: a haircut for RToken holders.
        _accumulate();
        Fix melting = (toFix(totalSupply).plusu(furnace.totalBurnt())).divu(totalSupply);
        _historicalBasketDilution = melting.mulu(vault.basketUnits(address(this))).divu(totalSupply);
        return Mood.CALM;
    }

    /// Runs all auctions for revenue
    function _doRevenueAuctions() internal returns (Mood) {
        uint256 auctionLenSnapshot = auctions.length;

        // Empty oldest vault
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            oldVault.redeem(address(this), oldVault.basketUnits(address(this)));
        }

        // RToken -> dividend RSR
        (bool launch, Auction.Info memory auction) = _prepareAuctionSell(
            _config.minRevenueAuctionSize,
            rTokenAsset,
            rsrAsset,
            rToken().balanceOf(address(this)),
            Fate.Stake
        );

        if (launch) {
            _launchAuction(auction);
        }

        if (_config.f.eq(FIX_ONE) || _config.f.eq(FIX_ZERO)) {
            // One auction only
            IAsset buyAsset = (_config.f.eq(FIX_ONE)) ? rsrAsset : rTokenAsset;
            Fate fate = (_config.f.eq(FIX_ONE)) ? Fate.Stake : Fate.Melt;

            // COMP -> `buyAsset`
            (launch, auction) = _prepareAuctionSell(
                _config.minRevenueAuctionSize,
                compAsset,
                buyAsset,
                compAsset.erc20().balanceOf(address(this)),
                fate
            );
            if (launch) {
                _launchAuction(auction);
            }

            // AAVE -> `buyAsset`
            (launch, auction) = _prepareAuctionSell(
                _config.minRevenueAuctionSize,
                aaveAsset,
                buyAsset,
                aaveAsset.erc20().balanceOf(address(this)),
                fate
            );
            if (launch) {
                _launchAuction(auction);
            }
        } else {
            // Auctions in pairs, sized based on `f:1-f`
            bool launch2;
            Auction.Info memory auction2;

            // COMP -> dividend RSR + melting RToken
            (launch, launch2, auction, auction2) = _prepareRevenueAuctionPair(compAsset);
            if (launch && launch2) {
                _launchAuction(auction);
                _launchAuction(auction2);
            }

            // AAVE -> dividend RSR + melting RToken
            (launch, launch2, auction, auction2) = _prepareRevenueAuctionPair(aaveAsset);
            if (launch && launch2) {
                _launchAuction(auction);
                _launchAuction(auction2);
            }
        }

        return auctions.length == auctionLenSnapshot ? Mood.CALM : Mood.TRADING;
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
            Fix bal = toFix(a.erc20().balanceOf(address(this)));

            // {attoUSD} = {attoUSD} + {attoUSD/qTok} * {qTok}
            totalValue = totalValue.plus(a.priceUSD(this).mul(bal));
        }
        // {BU} = {attoUSD} / {attoUSD/BU}
        Fix targetBUs = totalValue.div(vault.basketRate());

        // Calculate surplus and deficits relative to the BU target.
        Fix[] memory surplus = new Fix[](_alltimeCollateral.length());
        Fix[] memory deficit = new Fix[](_alltimeCollateral.length());
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            ICollateral a = ICollateral(_alltimeCollateral.at(i));
            Fix bal = toFix(a.erc20().balanceOf(address(this))); // {qTok}

            // {qTok} = {BU} * {qTok/BU}
            Fix target = targetBUs.mulu(vault.quantity(a));
            if (bal.gt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surplus[i] = bal.minus(target).mul(a.priceUSD(this));
            } else if (bal.lt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficit[i] = target.minus(bal).mul(a.priceUSD(this));
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
        Fix sellAmount = surplusMax.div(sell.priceUSD(this));

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(buy.priceUSD(this));
        return (sell, buy, sellAmount.toUint(), buyAmount.toUint());
    }

    /// Prepares an auction pair for revenue RSR + revenue RToken that is sized `f:1-f`
    /// @return launch Should launch auction 1?
    /// @return launch2 Should launch auction 2?
    /// @return auction An auction selling `asset` for RSR, sized `f`
    /// @return auction2 An auction selling `asset` for RToken, sized `1-f`
    function _prepareRevenueAuctionPair(IAsset asset)
        internal
        returns (
            bool launch,
            bool launch2,
            Auction.Info memory auction,
            Auction.Info memory auction2
        )
    {
        // Calculate the two auctions without maintaining `f:1-f`
        Fix bal = toFix(asset.erc20().balanceOf(address(this)));
        Fix amountForRSR = bal.mul(_config.f);
        Fix amountForRToken = bal.minus(amountForRSR);

        (launch, auction) = _prepareAuctionSell(
            _config.minRevenueAuctionSize,
            asset,
            rsrAsset,
            amountForRSR.toUint(),
            Fate.Stake
        );
        (launch2, auction2) = _prepareAuctionSell(
            _config.minRevenueAuctionSize,
            asset,
            rTokenAsset,
            amountForRToken.toUint(),
            Fate.Melt
        );
        if (!launch || !launch2) {
            return (false, false, auction, auction2);
        }

        // Resize the smaller auction to cause the ratio to be `f:1-f`
        Fix expectedRatio = amountForRSR.div(amountForRToken);
        Fix actualRatio = toFix(auction.sellAmount).divu(auction2.sellAmount);
        if (actualRatio.lt(expectedRatio)) {
            Fix smallerAmountForRToken = amountForRSR.mul(FIX_ONE.minus(_config.f)).div(_config.f);
            (launch2, auction2) = _prepareAuctionSell(
                _config.minRevenueAuctionSize,
                asset,
                rTokenAsset,
                smallerAmountForRToken.toUint(),
                Fate.Melt
            );
        } else if (actualRatio.gt(expectedRatio)) {
            Fix smallerAmountForRSR = amountForRToken.mul(_config.f).div(FIX_ONE.minus(_config.f));
            (launch, auction) = _prepareAuctionSell(
                _config.minRevenueAuctionSize,
                asset,
                rsrAsset,
                smallerAmountForRSR.toUint(),
                Fate.Stake
            );
        }
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
        // {attoUSD} = {attoUSD/qSellTok} * {qSellTok}
        Fix rTokenMarketCapUSD = rTokenAsset.priceUSD(this).mulu(rToken().totalSupply());
        Fix maxSellUSD = rTokenMarketCapUSD.mul(_config.maxAuctionSize); // {attoUSD}
        Fix minSellUSD = rTokenMarketCapUSD.mul(minAuctionSize); // {attoUSD}

        // {qSellTok} < {attoUSD} / {attoUSD/qSellTok}
        if (sellAmount == 0 || sellAmount < minSellUSD.div(sell.priceUSD(this)).toUint()) {
            return (false, auction);
        }

        sellAmount = Math.min(sellAmount, maxSellUSD.div(sell.priceUSD(this)).toUint()); // {qSellTok}
        Fix exactBuyAmount = toFix(sellAmount).mul(sell.priceUSD(this)).div(buy.priceUSD(this)); // {qBuyTok}
        Fix minBuyAmount = exactBuyAmount.minus(exactBuyAmount.mul(_config.maxTradeSlippage)); // {qBuyTok}

        return (
            true,
            Auction.Info({
                sell: sell,
                buy: buy,
                sellAmount: sellAmount,
                minBuyAmount: minBuyAmount.toUint(),
                clearingSellAmount: 0,
                clearingBuyAmount: 0,
                startTime: block.timestamp,
                endTime: block.timestamp + _config.auctionPeriod,
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
            // {qSellTok} = {qBuyTok} * {attoUSD/qBuyTok} / {attoUSD/qSellTok}
            Fix exactSellAmount = toFix(auction.minBuyAmount).mul(buy.priceUSD(this)).div(sell.priceUSD(this));

            // {qSellTok} = {qSellTok} / {none}
            auction.sellAmount = exactSellAmount.div(FIX_ONE.minus(_config.maxTradeSlippage)).toUint();
            assert(auction.sellAmount < maxSellAmount);

            // {attoUSD} = {attoUSD/qRTok} * {qRTok}
            Fix rTokenMarketCapUSD = rTokenAsset.priceUSD(this).mulu(rToken().totalSupply());
            Fix minSellUSD = rTokenMarketCapUSD.mul(minAuctionSize);

            // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
            uint256 minSellAmount = minSellUSD.div(sell.priceUSD(this)).toUint();
            if (auction.sellAmount < minSellAmount) {
                return (false, emptyAuction);
            }
        }

        return (true, auction);
    }
}

// solhint-enable max-states-count
