// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/Auction.sol";
import "./libraries/SlowIssuance.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IFurnace.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ICollateral.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IManager.sol";
import "./FurnaceP0.sol";
import "./RTokenP0.sol";
import "./OracleP0.sol";
import "./StakingPoolP0.sol";

struct Config {
    // Time (seconds)
    uint256 rewardStart; // the timestamp of the very first weekly reward handout
    uint256 rewardPeriod; // the duration of time between reward events
    uint256 auctionPeriod; // the length of an auction
    uint256 stakingWithdrawalDelay; // the "thawing time" of staked RSR before withdrawal
    uint256 defaultDelay; // how long to wait until switching vaults after detecting default
    // Percentage values (relative to SCALE)
    uint256 maxTradeSlippage; // the maximum amount of slippage in percentage terms we will accept in a trade
    uint256 auctionClearingTolerance; // the maximum % difference between auction clearing price and oracle data allowed.
    uint256 maxAuctionSize; // the size of an auction, as a fraction of RToken supply
    uint256 minAuctionSize; // the size of an auction, as a fraction of RToken supply
    uint256 migrationChunk; // how much backing to migrate at a time, as a fraction of RToken supply
    uint256 issuanceRate; // the number of RToken to issue per block, as a fraction of RToken supply
    uint256 defaultThreshold; // the percent deviation required before a token is marked as in-default
    uint256 f; // The Revenue Factor: the fraction of revenue that goes to stakers
    // TODO: Revenue Distribution Map

    // Sample values
    //
    // rewardStart = timestamp of first weekly handout
    // rewardPeriod = 604800 (1 week)
    // auctionPeriod = 1800 (30 minutes)
    // stakingWithdrawalDelay = 1209600 (2 weeks)
    // defaultDelay = 86400 (24 hours)
    // maxTradeSlippage = 5e16 (5%)
    // auctionClearingTolerance = 1e17 (10%)
    // maxAuctionSize = 1e16 (1%)
    // minAuctionSize = 1e15 (0.1%)
    // migrationChunk = 2e17 (20%)
    // issuanceRate = 25e13 (0.025% per block, or ~0.1% per minute)
    // defaultThreshold = 5e16 (5% deviation)
    // f = 6e17 (60% to stakers)
}

/**
 * @title ManagerP0
 * @dev The Manager for a particular RToken + StakingPool.
 *
 * This contract:
 *    - Provides RToken issuance/redemption.
 *    - Manages the choice of backing of an RToken via Vault selection.
 *    - Defines the exchange rate between Vault BUs and RToken supply, via the base factor.
 *    - Monitors Vault collateral for default. There are two types:
 *          A. Hard default - A strong invariant is broken; default immediately.
 *          B. Soft default - A weak invariant is broken; default after waiting (say 24h).
 *    - Runs 3 types of auctions:
 *          A. Collateral-for-collateral   (Migration auctions)
 *          B. RSR-for-RToken              (Recapitalization auctions)
 *          C. COMP/AAVE-for-RToken        (Revenue auctions)
 */
contract ManagerP0 is IManager, Ownable {
    using SafeERC20 for IERC20;
    using SlowIssuance for SlowIssuance.Info;
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant SCALE = 1e18;

    // ECONOMICS (Note that SCALE is ignored here. These are the abstract mathematical relationships)
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatio / _basketDilutionRatio
    // _basketDilutionRatio = _currentBasketDilution * _historicalBasketDilution
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    Config internal _config;
    uint256 internal _meltingRatio = 1e18;
    uint256 internal _basketDilutionRatio = 1e18; // _currentBasketDilution * _historicalBasketDilution
    uint256 internal _currentBasketDilution = 1e18; // for this current vault, since the last time *f* was changed
    uint256 internal _historicalBasketDilution = 1e18; // the product of all historical basket dilutions
    uint256 internal _prevBasketFiatcoinRate; // redemption value of the basket in fiatcoins last update

    // Deployed by Manager, maybe pull out later
    IRToken public rToken;
    IFurnace public furnace;
    IStakingPool public staking;

    // Pre-existing deployments
    IVault public vault;
    IOracle public oracle;

    // Append-only record keeping
    IVault[] public pastVaults;
    mapping(uint256 => SlowIssuance.Info) public issuances;
    uint256 public issuanceCount;
    mapping(uint256 => Auction.Info) public auctions;
    uint256 public auctionCount;

    // Pausing (Isomorphic to "Caution" state)
    address public pauser;
    bool public override paused;

    // Default detection.
    bool public inDoubt;
    uint256 public doubtRaisedAt; // timestamp when default occurred
    EnumerableSet.AddressSet internal _approvedCollateral;
    EnumerableSet.AddressSet internal _allKnownCollateral;
    EnumerableSet.AddressSet internal _fiatcoins;
    mapping(address => uint256) internal _redemptionRates; // the redemption rates for all known collateral last time it was checked

    constructor(
        string memory name_,
        string memory symbol_,
        IVault vault_,
        IOracle oracle_,
        IERC20 rsr_,
        Config memory config_,
        ICollateral[] memory approvedCollateral_
    ) {
        rToken = new RTokenP0(name_, symbol_, _msgSender(), address(this));
        furnace = new FurnaceP0(address(rToken));
        staking = new StakingPoolP0(
            string(abi.encodePacked("Staked RSR - ", name_)),
            string(abi.encodePacked("st", symbol_, "RSR")),
            _msgSender(),
            address(this),
            address(rsr_),
            config_.stakingWithdrawalDelay
        );
        vault = vault_;
        oracle = oracle_;
        _config = config_;
        for (uint256 i = 0; i < approvedCollateral_.length; i++) {
            approveCollateral(approvedCollateral_[i]);
        }
        if (!vault.containsOnly(_approvedCollateral.values())) {
            revert CommonErrors.UnapprovedToken();
        }

        pauser = _msgSender();
        _prevBasketFiatcoinRate = vault.basketFiatcoinRate();
        staking.rsr().approve(address(staking), type(uint256).max);
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    // This modifier runs before every function including redemption, so it needs to be very safe.
    modifier always() {
        // Check for hard default (ie redemption rates fail to increase monotonically)
        ICollateral[] memory hardDefaulting = _checkForHardDefault();
        if (!paused && hardDefaulting.length > 0) {
            _switchVaults(hardDefaulting);
        }
        _melt();
        _diluteBasket();
        _;
    }

    // Runs auctions
    function poke() external override notPaused always {
        require(!inDoubt, "in doubt");
        _processSlowIssuance();
        _manageAuctions();
    }

    // Default check
    function noticeDefault() external override notPaused always {
        // Note that _always()_ checks for hard default.

        // Check for soft default
        ICollateral[] memory softDefaulting = vault.softDefaultingCollateral(oracle, _defaultThreshold());
        if (!inDoubt && softDefaulting.length > 0) {
            _processSlowIssuance();
            inDoubt = true;
            doubtRaisedAt = block.timestamp;
        } else if (inDoubt && block.timestamp >= doubtRaisedAt) {
            // If no doubt anymore
            if (softDefaulting.length == 0) {
                inDoubt = false;
            } else {
                // If doubt has been raised for 24 (default delay) hours, select new vault
                if (block.timestamp >= doubtRaisedAt + _config.defaultDelay) {
                    _switchVaults(softDefaulting);
                    inDoubt = false;
                }
            }
        }
    }

    function issue(uint256 amount) external override notPaused always {
        require(!inDoubt, "in doubt");
        require(amount > 0, "Cannot issue zero");
        _processSlowIssuance();
        uint256 issuanceRate = _issuanceRate();
        uint256 numBlocks = Math.ceilDiv(amount, issuanceRate);

        // Mint the RToken now and hold onto it while the slow issuance vests
        SlowIssuance.Info storage issuance = issuances[issuanceCount];
        issuance.start(vault, amount, _toBUs(amount), _msgSender(), _slowMintingEnd() + numBlocks * issuanceRate);
        rToken.mint(address(this), amount);
        issuanceCount++;
    }

    function redeem(uint256 amount) external override always {
        require(amount > 0, "Cannot redeem zero");
        if (!paused) {
            _processSlowIssuance();
        }
        rToken.burn(_msgSender(), amount);
        _oldestNonEmptyVault().redeem(_msgSender(), _toBUs(amount));
    }

    function pause() external override {
        require(_msgSender() == pauser, "only pauser");
        paused = true;
    }

    function unpause() external override {
        require(_msgSender() == pauser, "only pauser");
        paused = false;
    }

    //

    function setPauser(address pauser_) external onlyOwner {
        pauser = pauser_;
    }

    function setVault(IVault vault_) external onlyOwner {
        vault = vault_;
        _prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    function setConfig(Config memory config_) external onlyOwner {
        // When f changes we need to accumulate the historical basket dilution
        if (_config.f != config_.f) {
            _accumulateDilutionFactor();
        }
        _config = config_;
    }

    function approveCollateral(ICollateral collateral) public onlyOwner {
        _approvedCollateral.add(address(collateral));
        _allKnownCollateral.add(address(collateral));
        if (collateral.isFiatcoin()) {
            _fiatcoins.add(address(collateral));
        }
    }

    function unapproveCollateral(ICollateral collateral) public onlyOwner {
        _approvedCollateral.remove(address(collateral));
        if (collateral.isFiatcoin()) {
            _fiatcoins.remove(address(collateral));
        }
    }

    //

    function quoteIssue(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote issue zero");
        return vault.tokenAmounts(_toBUs(amount));
    }

    function quoteRedeem(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return vault.tokenAmounts(_toBUs(amount));
    }

    function fullyCapitalized() public view override returns (bool) {
        return vault.basketUnits(address(this)) >= _toBUs(rToken.totalSupply());
    }

    //

    function _toBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _basketDilutionRatio) / _meltingRatio;
    }

    function _fromBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _meltingRatio) / _basketDilutionRatio;
    }

    // Calculates the block-by-block RToken issuance rate for slow issuance.
    function _issuanceRate() internal view returns (uint256) {
        // Lower-bound of 10_000 per block
        return Math.max(10_000 * 10**rToken.decimals(), (rToken.totalSupply() * _config.issuanceRate) / SCALE);
    }

    // Returns the timestamp at which the latest slow issuance ends. Worst-case: Current timestamp.
    function _slowMintingEnd() internal view returns (uint256) {
        if (issuanceCount == 0) {
            return block.timestamp;
        }
        return Math.max(block.timestamp, issuances[issuanceCount - 1].availableAt);
    }

    // Returns the oldest vault that contains nonzero BUs.
    // Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    // contains no collateral tokens.
    function _oldestNonEmptyVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    // Computes the USD price (18 decimals) at which a fiatcoin should be considered to be defaulting.
    function _defaultThreshold() internal view returns (uint256) {
        // Collect prices
        uint256[] memory prices = new uint256[](_fiatcoins.length());
        for (uint256 i = 0; i < _fiatcoins.length(); i++) {
            prices[i] = oracle.fiatcoinPrice(ICollateral(_fiatcoins.at(i)));
        }

        // Sort
        for (uint256 i = 1; i < prices.length; i++) {
            uint256 key = prices[i];
            uint256 j = i - 1;
            while (j >= 0 && prices[j] > key) {
                prices[j + 1] = prices[j];
                j--;
            }
            prices[j + 1] = key;
        }

        // Take the median
        uint256 price;
        if (prices.length % 2 == 0) {
            price = (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
        } else {
            price = prices[prices.length / 2];
        }

        return (price * (SCALE - _config.defaultThreshold)) / SCALE;
    }

    //

    // Returns a list of the collateral that are hard defaulting, meaning we should immediately jump ship.
    function _checkForHardDefault() internal returns (ICollateral[] memory defaulting) {
        ICollateral[] memory all = new ICollateral[](vault.basketSize());
        uint256 count;
        for (uint256 i = 0; i < vault.basketSize(); i++) {
            ICollateral c = vault.collateralAt(i);
            if (c.redemptionRate() + 1 < _redemptionRates[address(c)]) {
                all[count] = c;
                count++;
            }
        }
        defaulting = new ICollateral[](count);
        for (uint256 i = 0; i < count; i++) {
            defaulting[i] = all[i];
        }

        if (count == 0) {
            for (uint256 i = 0; i < _allKnownCollateral.length(); i++) {
                ICollateral c = ICollateral(_allKnownCollateral.at(i));
                _redemptionRates[address(c)] = c.redemptionRate();
            }
        }
    }

    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuanceCount; i++) {
            if (!issuances[i].processed && issuances[i].availableAt <= block.timestamp) {
                issuances[i].process(rToken, vault);
            }
        }
    }

    // Melts RToken, increasing the base factor and thereby causing an RToken to appreciate.
    function _melt() internal {
        furnace.doBurn();
        if (rToken.totalSupply() > 0) {
            _meltingRatio = (SCALE * (rToken.totalSupply() + furnace.totalBurnt())) / rToken.totalSupply();
        }
    }

    // Reduces basket quantities slightly in order to pass through basket appreciation to stakers.
    // Uses a closed-form calculation that is anchored to the last time the vault or *f* was changed.
    function _diluteBasket() internal {
        // Idempotent
        uint256 current = vault.basketFiatcoinRate();
        _currentBasketDilution = SCALE + _config.f * ((SCALE * current) / _prevBasketFiatcoinRate - SCALE);
        _basketDilutionRatio = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
    }

    // Upon vault change or change to *f*, we accumulate the historical dilution factor.
    function _accumulateDilutionFactor() internal {
        // Idempotent
        _diluteBasket();
        // TODO: Is this acceptable? There's compounding error but so few number of times.
        _historicalBasketDilution = (_historicalBasketDilution * _currentBasketDilution) / SCALE;
        _currentBasketDilution = SCALE;
        _prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    //

    // Unapproves the defaulting collateral and switches the RToken over to a new Vault.
    function _switchVaults(ICollateral[] memory defaulting) internal {
        for (uint256 i = 0; i < defaulting.length; i++) {
            unapproveCollateral(defaulting[i]);
        }

        IVault newVault = vault.selectBackup(_approvedCollateral.values(), oracle, _defaultThreshold());
        if (address(newVault) != address(0)) {
            pastVaults.push(vault);
            vault = newVault;
            _prevBasketFiatcoinRate = vault.basketFiatcoinRate();
        }

        // Undo all open slowmintings
        _processSlowIssuance();

        // Accumulate the basket dilution factor to enable correct forward accounting
        _accumulateDilutionFactor();
    }

    //

    // Continually runs auctions as long as we are undercollateralized.
    // Algorithm:
    //     1. Closeout previous auctions
    //     2. Create BUs from collateral
    //     3. Break off BUs from the old vault for collateral
    //     4. Launch a collateral-for-collateral auction until we are left with dust
    //     5. If it's all dust: sell RSR and buy RToken and burn it
    //     6. If we run out of RSR: give RToken holders a haircut to get back to capitalized
    function _manageAuctions() internal {
        // Halt if an auction is ongoing
        Auction.Info storage prev = auctionCount > 0 ? auctions[auctionCount - 1] : auctions[0];
        if (prev.open) {
            if (block.timestamp <= prev.endTime) {
                return;
            }

            // Closeout auction and check that prices are reasonable (for collateral-for-collateral auctions).
            uint256 buyAmount = prev.closeOut(_config.rewardPeriod);
            if (
                address(prev.sellCollateral) != address(0) &&
                address(prev.buyCollateral) != address(0) &&
                !prev.clearedCloseToOraclePrice(oracle, SCALE, buyAmount, _config.auctionClearingTolerance)
            ) {
                // Enter Caution state and pause everything
                paused = true;
            }
        }

        // Create as many BUs as we can
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            vault.issue(issuable);
        }

        // Halt if paused or capitalized
        if (paused || fullyCapitalized()) {
            return;
        }

        // Are we able to trade sideways, or is it all dust?
        (bool trade, ICollateral sell, ICollateral buy, uint256 sellAmount, uint256 minBuy) = _collateralTrade();

        // If we are in the Migration state, redeem BUs to open up spare collateral
        IVault oldVault = _oldestNonEmptyVault();
        if (!trade && address(oldVault) != address(vault)) {
            uint256 max = _toBUs(((rToken.totalSupply()) * _config.migrationChunk) / SCALE);
            uint256 chunk = Math.min(max, oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);

            // Decide whether to trade and exactly which trade.
            (trade, sell, buy, sellAmount, minBuy) = _collateralTrade();
        }
        address sellToken = sell.erc20();
        address buyToken = buy.erc20();
        address destination = address(this);

        uint256 stakedRSR = staking.rsr().balanceOf(address(staking));
        if (!trade && stakedRSR > 0) {
            // Final backstop: Use RSR to buy back RToken and burn it.
            sellToken = address(staking.rsr());
            buyToken = address(rToken);
            destination = address(0);

            uint256 rsrUSD = oracle.consultAave(address(staking.rsr()));
            uint256 rTokenUSDEstimate = vault.basketFiatcoinRate();
            uint256 unbackedRToken = rToken.totalSupply() - _fromBUs(vault.basketUnits(address(this)));
            minBuy = Math.min(unbackedRToken, (rToken.totalSupply() * _config.maxAuctionSize) / SCALE);
            minBuy = Math.max(minBuy, (rToken.totalSupply() * _config.minAuctionSize) / SCALE);
            sellAmount = (minBuy * rTokenUSDEstimate) / rsrUSD;
            sellAmount = ((sellAmount * SCALE) / (SCALE - _config.maxTradeSlippage));

            staking.seizeRSR(sellAmount - staking.rsr().balanceOf(address(this)));
        } else if (!trade) {
            // We've reached the endgame...time to concede and give RToken holders a haircut.
            _accumulateDilutionFactor();
            _historicalBasketDilution = (_meltingRatio * vault.basketUnits(address(this))) / rToken.totalSupply();
            return;
        }

        // At this point in the code this is either a collateral-for-collateral trade or an RSR-for-RToken trade.
        uint256 auctionEnd = block.timestamp + _config.auctionPeriod;
        Auction.Info storage auction = auctions[auctionCount];
        auction.start(sell, buy, sellToken, buyToken, sellAmount, minBuy, auctionEnd, destination);
        auctionCount++;
    }

    // Determines if a trade should be made and what it should be.
    // Algorithm:
    //     1. Target a particular number of basket units based on total fiatcoins held across all collateral.
    //     2. Swap the most-in-excess collateral for most-in-deficit.
    //     3. Confirm swap is for a large enough volume. We don't want to trade endlessly.
    function _collateralTrade()
        internal
        returns (
            bool shouldTrade,
            ICollateral sell,
            ICollateral buy,
            uint256 sellAmount,
            uint256 minBuyAmount
        )
    {
        // Calculate how many BUs we could create from all collateral if we could trade with 0 slippage
        uint256 totalValue;
        uint256[] memory prices = new uint256[](_allKnownCollateral.length()); // USD with 18 decimals
        for (uint256 i = 0; i < _allKnownCollateral.length(); i++) {
            ICollateral c = ICollateral(_allKnownCollateral.at(i));
            prices[i] = (c.redemptionRate() * oracle.fiatcoinPrice(c)) / SCALE;
            totalValue += IERC20(c.erc20()).balanceOf(address(this)) * prices[i];
        }
        uint256 BUTarget = (totalValue * SCALE) / vault.basketFiatcoinRate();

        uint256[] memory surplus = new uint256[](_allKnownCollateral.length());
        uint256[] memory deficit = new uint256[](_allKnownCollateral.length());
        // Calculate surplus and deficits relative to the BU target.
        for (uint256 i = 0; i < _allKnownCollateral.length(); i++) {
            ICollateral c = ICollateral(_allKnownCollateral.at(i));
            uint256 bal = IERC20(c.erc20()).balanceOf(address(this));
            uint256 target = (vault.quantity(c) * BUTarget) / SCALE;
            if (bal > target) {
                surplus[i] = ((bal - target) * prices[i]) / SCALE;
            } else if (bal < target) {
                deficit[i] = ((target - bal) * prices[i]) / SCALE;
            }
        }

        // Calculate the maximums.
        uint256 sellIndex;
        uint256 buyIndex;
        uint256 surplusMax;
        uint256 deficitMax;
        for (uint256 i = 0; i < _allKnownCollateral.length(); i++) {
            if (surplus[i] > surplusMax) {
                surplusMax = surplus[i];
                sellIndex = i;
            }
            if (deficit[i] > deficitMax) {
                deficitMax = deficit[i];
                buyIndex = i;
            }
        }

        // Determine if the trade is large enough to be worth doing and calculate amounts.
        {
            uint256 minAuctionSizeInBUs = _toBUs((rToken.totalSupply() * _config.minAuctionSize) / SCALE);
            uint256 minAuctionSizeInFiatcoins = (minAuctionSizeInBUs * vault.basketFiatcoinRate()) / SCALE;
            shouldTrade = deficitMax > minAuctionSizeInFiatcoins && surplusMax > minAuctionSizeInFiatcoins;
            minBuyAmount = (deficitMax * SCALE) / prices[buyIndex];
            sell = ICollateral(_allKnownCollateral.at(sellIndex));
            buy = ICollateral(_allKnownCollateral.at(buyIndex));
        }

        uint256 maxSell = ((deficitMax * SCALE) / (SCALE - _config.maxTradeSlippage));
        sellAmount = (Math.min(maxSell, surplusMax) * SCALE) / sell.redemptionRate();
        return (shouldTrade, sell, buy, sellAmount, minBuyAmount);
    }
}
