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
import "./libraries/SlowMinting.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IFaucet.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ICollateral.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IManager.sol";
import "./FaucetP0.sol";
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
    // maxAuctionSize = 1e16 (1%)
    // minAuctionSize = 1e15 (0.1%)
    // migrationChunk = 2e17 (20%)
    // issuanceRate = 25e13 (0.025% per block, or ~0.1% per minute)
    // defaultThreshold = 5e16 (5% deviation)
    // f = 6e17 (60% to stakers)
}

contract ManagerP0 is IManager, Ownable {
    using SafeERC20 for IERC20;
    using SlowMinting for SlowMinting.Info;
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant SCALE = 1e18;

    // ECONOMICS (Note that SCALE is ignored here. These are the abstract mathematical relationships)
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatio / basketDilutionRatio
    // basketDilutionRatio = _currentBasketDilution * _historicalBasketDilution
    // <RToken> = b * <Basket Unit Vector>
    // #RTokens <= #BUs / b
    // #BUs = vault.basketUnits(address(this))
    // Cycle: Normal -> Doubt -> Default -> Migration -> Normal

    Config internal _config;
    uint256 internal _meltingRatio = 1e18;
    uint256 internal _basketDilutionRatio = 1e18; // _currentBasketDilution * _historicalBasketDilution
    uint256 internal _currentBasketDilution = 1e18; // for this current vault, since the last time *f* was changed
    uint256 internal _historicalBasketDilution = 1e18; // the product of all historical basket dilutions
    uint256 internal _prevBasketFiatcoinRate; // redemption value of the basket in fiatcoins last update
    uint256 internal _melted; // how many RTokens have been melted

    // Deployed by Manager
    IRToken public rToken;
    IFaucet public faucet;
    IStakingPool public staking;

    // Pre-existing deployments
    IVault public vault;
    IOracle public oracle;

    // Append-only record keeping
    IVault[] public pastVaults;
    mapping(uint256 => SlowMinting.Info) public mintings;
    uint256 mintingCount;
    mapping(uint256 => Auction.Info) public auctions;
    uint256 auctionCount;

    // Pausing
    address public pauser;
    bool public paused;

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
        faucet = new FaucetP0(address(this), address(rToken));
        staking = new StakingPoolP0(
            string(abi.encodePacked("Staked RSR - ", name_)),
            string(abi.encodePacked("st", symbol_, "RSR")),
            _msgSender(),
            address(rToken),
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

    modifier notInDoubt() {
        require(!inDoubt, "in doubt");
        _;
    }

    modifier before() {
        // Check for hard default (ie redemption rates fail to increase monotonically)
        ICollateral[] memory hardDefaulting = _checkForHardDefault();
        if (hardDefaulting.length > 0) {
            _switchVaults(hardDefaulting);
        }

        faucet.drip();
        _melt();
        _diluteBasket();
        _processSlowMintings();
        _;
    }

    function poke() external override notPaused notInDoubt before {
        _manageAuctions();
    }

    // Default check (on-demand)
    function detectDefault() external override notPaused before {
        // Note that _before_ checks for hard default.

        // Check for soft default
        ICollateral[] memory softDefaulting = vault.softDefaultingCollateral(oracle, _defaultThreshold());
        if (!inDoubt && softDefaulting.length > 0) {
            inDoubt = true;
            doubtRaisedAt = block.timestamp;
        } else if (block.timestamp >= doubtRaisedAt) {
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

    function issue(uint256 amount) external override notPaused notInDoubt before {
        require(amount > 0, "Cannot issue zero");
        uint256 issuanceRate = _issuanceRate();
        uint256 numBlocks = Math.ceilDiv(amount, issuanceRate);

        // Mint the RToken now and hold onto it while the slow minting vests
        SlowMinting.Info storage minting = mintings[mintingCount + 1];
        minting.start(vault, amount, _toBUs(amount), _msgSender(), _slowMintingEnd() + numBlocks * issuanceRate);
        rToken.mint(address(this), amount);
        mintingCount++;
    }

    function redeem(uint256 amount) external override notPaused before {
        require(amount > 0, "Cannot redeem zero");
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
        _allKnownCollateral.remove(address(collateral));
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

    //

    function _toBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _basketDilutionRatio) / _meltingRatio;
    }

    function _fromBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _meltingRatio) / _basketDilutionRatio;
    }

    function _issuanceRate() internal view returns (uint256) {
        // Lower-bound of 10_000 per block
        return Math.max(10_000 * 10**rToken.decimals(), (rToken.totalSupply() * _config.issuanceRate) / SCALE);
    }

    function _slowMintingEnd() internal view returns (uint256) {
        if (mintingCount == 0) {
            return block.timestamp;
        }
        return Math.max(block.timestamp, mintings[mintingCount - 1].availableAt);
    }

    // Returns the oldest vault that contains at nonzero BUs
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

    function _processSlowMintings() internal {
        if (inDoubt) {
            return;
        }
        for (uint256 i = 0; i < mintingCount; i++) {
            if (!mintings[i].processed && address(mintings[i].vault) != address(vault)) {
                rToken.burn(address(this), mintings[i].amount);
                mintings[i].undo();
            } else if (!mintings[i].processed && mintings[i].availableAt >= block.timestamp) {
                rToken.transfer(mintings[i].minter, mintings[i].amount);
                mintings[i].complete();
            }
        }
    }

    function _melt() internal {
        uint256 amount = rToken.balanceOf(address(this));
        rToken.burn(address(this), amount);
        _melted += amount;
        _meltingRatio = (SCALE * (rToken.totalSupply() + _melted)) / rToken.totalSupply();
    }

    // Idempotent
    function _diluteBasket() internal {
        uint256 current = vault.basketFiatcoinRate();
        _currentBasketDilution = SCALE + _config.f * ((SCALE * current) / _prevBasketFiatcoinRate - SCALE);
        _basketDilutionRatio = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
    }

    // Upon vault change or change to *f*, we accumulate the historical dilution factor.
    // Idempotent
    function _accumulateDilutionFactor() internal {
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
        }

        // Undo all live slowmintings
        _processSlowMintings();

        // Accumulate the basket dilution factor to enable forward accounting
        _accumulateDilutionFactor();
    }

    //

    // Continually runs auctions as long as we are undercollateralized.
    function _manageAuctions() internal {
        // Halt if an auction is ongoing
        Auction.Info storage prev = auctionCount > 0 ? auctions[auctionCount - 1] : auctions[0];
        if (prev.open) {
            if (block.timestamp <= prev.endTime) {
                return;
            }
            prev.closeOut();
        }

        // Create as many BUs as we can
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            vault.issue(issuable);
        }

        // Check for capitalization
        if (vault.basketUnits(address(this)) >= _toBUs(rToken.totalSupply())) {
            return;
        }

        // If vaults are still different, redeem BUs to open up spare collateral
        IVault oldVault = _oldestNonEmptyVault();
        if (address(oldVault) != address(vault)) {
            uint256 target = _toBUs(rToken.totalSupply());
            uint256 current = vault.basketUnits(address(this));
            uint256 max = _toBUs((rToken.totalSupply() * _config.maxAuctionSize) / SCALE);
            uint256 chunk = Math.min(max, current < target ? target - current : oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);
        }

        // Decide whether to trade and exactly which trade.
        (bool trade, address sellToken, uint256 sellAmount, address buyToken, uint256 minBuy) = _collateralTrade();

        uint256 stakedRSR = staking.rsr().balanceOf(address(staking));
        if (!trade && stakedRSR > 0) {
            // Final backstop: Use RSR to buy back RToken and burn it.
            sellToken = address(staking.rsr());
            buyToken = address(rToken);

            uint256 rsrUSD = oracle.consultAAVE(address(staking.rsr()));
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
        Auction.Info storage auction = auctions[auctionCount];
        auction.start(sellToken, buyToken, sellAmount, minBuy, block.timestamp + _config.auctionPeriod);
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
            address sellToken,
            uint256 sellAmount,
            address buyToken,
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
        uint256 surplusMax;
        uint256 deficitMax;
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
            sellToken = _allKnownCollateral.at(sellIndex);
            buyToken = _allKnownCollateral.at(buyIndex);
        }

        uint256 maxSell = ((deficitMax * SCALE) / (SCALE - _config.maxTradeSlippage));
        sellAmount = (Math.min(maxSell, surplusMax) * SCALE) / _redemptionRates[sellToken];
        return (shouldTrade, sellToken, sellAmount, buyToken, minBuyAmount);
    }
}
