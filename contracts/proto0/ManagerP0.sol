// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
    uint256 shortVWAPPeriod; // the VWAP length used during the raising of the default flag
    uint256 longVWAPPeriod; // the VWAP length used during the lowering of the default flag
    uint256 defaultDelay; // how long to wait until switching vaults after detecting default
    // Percentage values (relative to SCALE)
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
    // shortVWAPPeriod = 300 (5 minutes)
    // longVWAPPeriod = 21600 (6 hours)
    // defaultDelay = 86400 (24 hours)
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

    Config internal _config;
    uint256 internal _meltingRatio = 1e18;
    uint256 internal _basketDilutionRatio = 1e18; // _currentBasketDilution * _historicalBasketDilution
    uint256 internal _currentBasketDilution = 1e18; // for this current vault, since the last time *f* was changed
    uint256 internal _historicalBasketDilution = 1e18; // the product of all historical basket dilutions

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

    // Accounting
    uint256 public prevBasketFiatcoinRate; // redemption value of the basket in fiatcoins last update
    uint256 public lastAuction; // timestamp of the last auction
    uint256 public melted; // how many RTokens have been melted

    // Default detection
    bool public inDefault;
    uint256 public lastDefault; // timestamp when default occurred
    EnumerableSet.AddressSet internal _defaultedCollateral;
    EnumerableSet.AddressSet internal _approvedCollateral;
    mapping(address => uint256) internal _prevRedemptionRates; // the redemption rates for each collateral last time it was checked

    // Pausing
    address public pauser;
    bool public paused;

    constructor(
        string memory name_,
        string memory symbol_,
        IVault vault_,
        IOracle oracle_,
        IERC20 rsr_,
        Config memory config_,
        address[] memory approvedCollateral_
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
            _approvedCollateral.add(approvedCollateral_[i]);
        }
        if (!_approvedTokensOnly(vault)) {
            revert CommonErrors.UnapprovedToken();
        }

        pauser = _msgSender();
        prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    modifier before() {
        faucet.drip();
        _melt();
        _diluteBasket();
        _processSlowMintings();
        _;
        _saveRedemptionRates();
    }

    function poke() external override notPaused before {
        _manageAuctions();
    }

    // Default check (on-demand)
    function detectDefault() external override notPaused {
        // Check if already in default
        if (!inDefault) {
            (bool _defaulted, ICollateral[] memory _defaultCollateral) = _detectDefaultInVault(
                vault,
                _config.shortVWAPPeriod
            );

            // If Default detected - simply set timestamp and flag
            if (_defaulted) {
                // Raise default flag
                inDefault = true;
                lastDefault = block.timestamp;
                _setDefaultedCollateral(_defaultCollateral);
            }
        } else {
            // If Default already flagged - Check of long TWAP period has passed
            if (block.timestamp >= lastDefault + _config.longVWAPPeriod) {
                (bool _defaulted, ICollateral[] memory _defaultCollateral) = _detectDefaultInVault(
                    vault,
                    _config.longVWAPPeriod
                );

                // If No Default anymore,  lower default flag and cleanup
                if (!_defaulted) {
                    inDefault = false;
                    _cleanupDefaultedCollateral();
                } else {
                    _setDefaultedCollateral(_defaultCollateral);

                    // If the default flag has been raised for 24 (default delay) hours, select new vault
                    if (block.timestamp >= lastDefault + _config.defaultDelay) {
                        _switchVaults();
                    }
                }
            }
        }
    }

    function issue(uint256 amount) external override notPaused before {
        require(amount > 0, "Cannot issue zero");
        uint256 issuanceRate = _issuanceRate(amount);
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

    function approveCollateral(ICollateral collateral) external onlyOwner {
        _approvedCollateral.add(address(collateral));
    }

    function unapproveCollateral(ICollateral collateral) external onlyOwner {
        _approvedCollateral.remove(address(collateral));
    }

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

    function _issuanceRate(uint256 amount) internal view returns (uint256) {
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

    function _approvedTokensOnly(IVault v) internal view returns (bool) {
        for (uint256 i = 0; i < v.basketSize(); i++) {
            if (!_approvedCollateral.contains(address(v.collateralAt(i)))) {
                return false;
            }
        }
        return true;
    }

    function _saveRedemptionRates() internal {
        for (uint256 i = 0; i < _approvedCollateral.length(); i++) {
            ICollateral c = ICollateral(_approvedCollateral.at(i));
            _prevRedemptionRates[address(c)] = c.redemptionRate();
        }
    }

    function _processSlowMintings() internal {
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
        melted += amount;
        _meltingRatio = (SCALE * (rToken.totalSupply() + melted)) / rToken.totalSupply();
    }

    function _diluteBasket() internal {
        uint256 current = vault.basketFiatcoinRate();
        _currentBasketDilution = SCALE + _config.f * ((SCALE * current) / prevBasketFiatcoinRate - SCALE);
        _basketDilutionRatio = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
    }

    // Upon vault change or change to *f*, we accumulate the historical dilution factor.
    function _accumulateDilutionFactor() internal {
        _diluteBasket();
        _historicalBasketDilution = (_historicalBasketDilution * _currentBasketDilution) / SCALE;
        _currentBasketDilution = SCALE;
        prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    // Continually runs auctions as long as there is a past non-empty vault.
    function _manageAuctions() internal {
        // Try to launch an auction
        bool auctionRunning = _tryLaunchCollateralAuction();

        // Break a large chunk of BUs off the oldest vault if we need more collateral for trading
        IVault oldVault = _oldestNonEmptyVault();
        if (!auctionRunning && address(oldVault) != address(vault)) {
            uint256 target = _toBUs(rToken.totalSupply());
            uint256 current = vault.basketUnits(address(this));
            uint256 max = _toBUs((rToken.totalSupply() * _config.maxAuctionSize) / SCALE);
            uint256 chunk = Math.min(max, current < target ? target - current : oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);
            _tryLaunchCollateralAuction();
        }

        // Create as many BUs as we can in the current vault
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            vault.issue(issuable);
        }

        // TODO: RSR recapitalization
    }

    // Launches any collateral for collateral auctions and returns if there are any auctions running.
    // Note: Only one auction is live at any given time.
    function _tryLaunchCollateralAuction() internal returns (bool) {
        // Closeout previous auctions
        Auction.Info storage prev = auctionCount > 0 ? auctions[auctionCount - 1] : auctions[0];
        if (prev.open) {
            if (block.timestamp <= prev.endTime) {
                return true;
            }
            prev.closeOut();
        }

        // Are we capitalized?
        if (vault.basketUnits(address(this)) >= _toBUs(rToken.totalSupply())) {
            return false;
        }

        // Is the slush fund large enough to merit an auction?
        bool onlyDustLeft = true;
        uint256[] memory redemptionRates = new uint256[](_approvedCollateral.length());
        for (uint256 i = 0; i < redemptionRates.length; i++) {
            ICollateral c = ICollateral(_approvedCollateral.at(i));
            redemptionRates[i] = c.redemptionRate();
        }

        // uint256[] memory BUs = vault.calculateBUsPerCollateral(address(this));
        // for (uint i = 0; i < BUs.length; i++) {
        //     if (BUs[i] > _toBUs((rToken.totalSupply() * _config.minAuctionSize) / SCALE)) {

        //     }
        // }
        return true;
    }

    function _detectDefaultInVault(IVault vault_, uint256 period) internal view returns (bool, ICollateral[] memory) {
        bool _defaulted = false;
        ICollateral[] memory _defaultCollateral = new ICollateral[](vault_.basketSize());
        uint256 _price;

        for (uint256 i = 0; i < vault_.basketSize(); i++) {
            ICollateral c = vault_.collateralAt(i);

            // 1. Check fiatcoin redemption rates have not decreased since last time.
            if (c.redemptionRate() + 1 < _prevRedemptionRates[address(c)]) {
                // Set default detected
                _defaulted = true;
                _defaultCollateral[i] = c;
            }

            // 2. Check oracle prices of fiatcoins for default (received a TWAP period)
            // If any fiatcoins are 5% (default threshold) below their stable price raise flag
            _price = oracle.getPrice(c.fiatcoin(), period);
            // TODO: Apply correct calculation
            if (
                _price < 10**IERC20Metadata(c.fiatcoin()).decimals() /*  - 5% */
            ) {
                // Set default detected
                _defaulted = true;
                // Add tokens to defaulted set
                _defaultCollateral[i] = c;
            }
        }

        return (_defaulted, _defaultCollateral);
    }

    // Get best backup vault after defaul
    // Criteria: Highest basketFiatcoinRate value, and no defaulted tokens
    function _getBestBackupVault() internal returns (IVault) {
        uint256 _maxRate;
        uint256 indexMax = 0;

        // Loop through backups to find the best
        for (uint256 i = 0; i < vault.getBackups().length; i++) {
            IVault v = vault.backupAt(i);

            if (!_approvedTokensOnly(v)) {
                continue;
            }

            (bool _defaulted, ) = _detectDefaultInVault(v, _config.shortVWAPPeriod); // or longVWAPPeriod?

            if (!_defaulted) {
                // Get basketFiatcoinRate()
                uint256 _rate = v.basketFiatcoinRate();

                // See if it has the highest basket rate
                if (_rate > _maxRate) {
                    _maxRate = _rate;
                    indexMax = i;
                }
            }
        }

        // Return selected vault index
        if (indexMax > 0) {
            return vault.backupAt(indexMax);
        } else {
            return IVault(address(0));
        }
    }

    function _switchVaults() internal {
        IVault _newVault = _getBestBackupVault();
        if (address(_newVault) != address(0)) {
            pastVaults.push(vault);
            vault = _newVault;

            //  Lower default flag (keep defaulted tokens in list)
            inDefault = false;
        }

        // Undo all live slowmintings
        _processSlowMintings();

        // Accumulate the basket dilution factor to enable forward accounting
        _accumulateDilutionFactor();
    }

    // Add tokens to the enumerable set - Cleans it up first
    function _setDefaultedCollateral(ICollateral[] memory _collateral) internal {
        _cleanupDefaultedCollateral();
        for (uint256 i = 0; i < _collateral.length; i++) {
            _defaultedCollateral.add(address(_collateral[i]));
        }
    }

    // Cleanup the enumerable set
    function _cleanupDefaultedCollateral() internal {
        for (uint256 i = 0; i < _defaultedCollateral.length(); i++) {
            _defaultedCollateral.remove(_defaultedCollateral.at(i));
        }
    }
}
