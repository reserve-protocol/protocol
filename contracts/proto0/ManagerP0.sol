// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

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
    uint256 auctionSize; // the size of an auction, as a fraction of RToken supply
    uint256 issuanceRate; // the number of RToken to issue per block, as a fraction of RToken supply
    uint256 defaultThreshold; // the percent deviation required before a token is marked as in-default
    uint256 f; // The Revenue Factor: the fraction of revenue that goes to stakers

    // TODO: Revenue Distribution Map
}

contract ManagerP0 is IManager, Ownable {
    using SafeERC20 for IERC20;
    using SlowMinting for SlowMinting.Info;
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant SCALE = 1e18;

    // ECONOMICS
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatioScaled / _basketDilutionRatioScaled
    // <RToken> = b * <Basket Unit Vector>
    // #RTokens <= #BUs / b
    // #BUs = vault.basketUnits(address(this))

    Config internal _config;
    uint256 internal _meltingRatioScaled = 1e18; // increases the base factor
    uint256 internal _basketDilutionRatioScaled = 1e18; // decreases the base factor

    // Deployed by Manager
    IRToken public rToken;
    IFaucet public faucet;
    IStakingPool public staking;

    // Pre-existing deployments
    IVault public vault;
    IOracle public oracle;

    // Append-only records
    IVault[] public pastVaults;
    mapping(uint256 => SlowMinting.Info) public mintings;
    uint256 mintingCount;
    mapping(uint256 => Auction.Info) public auctions;
    uint256 auctionCount;

    // Accounting
    uint256 public prevBasketFiatcoinRate; // the redemption value of the basket in fiatcoins last time f was updated
    uint256 public lastAuction; // timestamp of the last auction
    uint256 public melted; // how many RTokens have been melted

    // Default detection
    bool public inDefault;
    uint256 public lastDefault; // timestamp when default occurred
    EnumerableSet.AddressSet internal _defaultedTokens;
    mapping(address => uint256) internal _prevRedemptionRates; // the redemption Rates for each token last time it was checked

    // Pausing
    address public pauser;
    bool public paused;

    constructor(
        string memory name_,
        string memory symbol_,
        IVault vault_,
        IOracle oracle_,
        IERC20 rsr_,
        Config memory config_
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
        // TODO: Check individual collateral redemption rates and default if they have decreased
        _diluteBasket();
        _processSlowMintings();
        _;
    }

    function poke() external override notPaused before {
        _runAuctions();
    }

    // Default check (on-demand)
    function detectDefault() external override notPaused {
        // Check if already in default
        if (!inDefault) {
            (bool _defaulted, address[] memory _defaultTokens) = _detectDefaultInVault(vault, _config.shortVWAPPeriod);

            // If Default detected - simply set timestamp and flag
            if (_defaulted) {
                // Raise default flag
                inDefault = true;
                lastDefault = block.timestamp;
                _setDefaultedTokens(_defaultTokens);
            }
        } else {
            // If Default already flagged - Check of long TWAP period has passed
            if (block.timestamp >= lastDefault + _config.longVWAPPeriod) {
                (bool _defaulted, address[] memory _defaultTokens) = _detectDefaultInVault(
                    vault,
                    _config.longVWAPPeriod
                );

                // If No Default anymore,  lower default flag and cleanup
                if (!_defaulted) {
                    inDefault = false;
                    _cleanupDefaultedTokens();
                } else {
                    _setDefaultedTokens(_defaultTokens);

                    // If the default flag has been raised for 24 (default delay) hours, select new vault
                    if (block.timestamp >= lastDefault + _config.defaultDelay) {
                        IVault _newVault = _getBestBackupVault();
                        if (address(_newVault) != address(0)) {
                            pastVaults.push(vault);
                            vault = _newVault;

                            //  Lower default flag (keep defaulted tokens in list)
                            inDefault = false;
                        }
                    }
                }
            }
        }
    }

    function issue(uint256 amount) external override notPaused before {
        require(amount > 0, "Cannot issue zero");
        uint256 issuanceRate = _issuanceRate(amount);
        uint256 numBlocks = Math.ceilDiv(amount, issuanceRate);

        SlowMinting.Info storage minting = mintings[mintingCount + 1];
        minting.start(vault, amount, _toBUs(amount), _msgSender(), _slowMintingEnd() + numBlocks * issuanceRate);
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
        return (amount * _basketDilutionRatioScaled) / _meltingRatioScaled;
    }

    function _fromBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _meltingRatioScaled) / _basketDilutionRatioScaled;
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

    function _oldestNonEmptyVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    function _processSlowMintings() internal {
        for (uint256 i = 0; i < mintingCount; i++) {
            if (!mintings[i].processed && address(mintings[i].vault) != address(vault)) {
                mintings[i].undo();
            } else if (!mintings[i].processed && mintings[i].availableAt >= block.timestamp) {
                mintings[i].complete();
                rToken.mint(mintings[i].minter, mintings[i].amount);
            }
        }
    }

    function _melt() internal {
        uint256 amount = rToken.balanceOf(address(this));
        rToken.burn(address(this), amount);
        melted += amount;
        _meltingRatioScaled = (SCALE * (rToken.totalSupply() + melted)) / rToken.totalSupply();
    }

    function _diluteBasket() internal {
        uint256 current = vault.basketFiatcoinRate();
        _basketDilutionRatioScaled = SCALE + _config.f * ((SCALE * current) / prevBasketFiatcoinRate - SCALE);
    }

    // Continually runs auctions as long as there is a past non-empty vault.
    function _runAuctions() internal {
        // Closeout previous auctions
        Auction.Info storage prev = auctionCount > 0 ? auctions[auctionCount - 1] : auctions[0];
        if (prev.open) {
            if (block.timestamp <= prev.endTime) {
                return;
            }
            prev.closeOut();
        }

        // Partially empty the oldest vault that still contains BUs into the RToken
        IVault oldVault = _oldestNonEmptyVault();
        if (address(oldVault) != address(vault)) {
            uint256 target = _toBUs(rToken.totalSupply());
            uint256 current = vault.basketUnits(address(this));
            uint256 max = _toBUs((rToken.totalSupply() * _config.auctionSize) / SCALE);
            uint256 chunk = Math.min(max, current < target ? target - current : oldVault.basketUnits(address(this)));
            oldVault.redeem(address(rToken), chunk);
            // (I know it's weird to use the RToken address like this, but the alternative is storing SlowMinting
            //      collateral in a separate Escrow contract. There is contention for the Manager's address.)
        }

        // Convert any balances at the RToken address into BUs
        uint256 issuable = vault.maxIssuable(address(rToken));
        if (issuable > 0) {
            uint256[] memory tokenAmounts = vault.tokenAmounts(issuable);
            for (uint256 i = 0; i < vault.basketSize(); i++) {
                rToken.withdrawToken(vault.collateralAt(i).erc20(), tokenAmounts[i]);
            }
            vault.issue(issuable);
        }

        // if we are still undercollateralized, launch the next auction
        if (vault.basketUnits(address(this)) < _toBUs(rToken.totalSupply())) {
            // TODO: Pick next auction and start it
        }
    }

    function _detectDefaultInVault(IVault vault_, uint256 period) internal view returns (bool, address[] memory) {
        bool _defaulted = false;
        address[] memory _defaultTokens = new address[](vault_.basketSize() * 6); // Worst case scenario in which all are defaulted
        uint256 _indexDefault;
        uint256 _price;

        for (uint256 i = 0; i < vault_.basketSize(); i++) {
            ICollateral c = vault_.collateralAt(i);

            // 1. Check fiatcoin redemption rates have not decreased since last time.
            if (c.getRedemptionRate() < _prevRedemptionRates[c.erc20()]) {
                // Set default detected
                _defaulted = true;
                _defaultTokens[_indexDefault] = c.erc20();
                _indexDefault++;
            }

            // 2. Check oracle prices of fiatcoins for default (received a TWAP period)
            // If any fiatcoins are 5% (default threshold) below their stable price raise flag
            _price = oracle.getPrice(c.getUnderlyingERC20(), period);
            // TODO: Apply correct calculation
            if (
                _price < 10**c.decimals() /*  - 5% */
            ) {
                // Set default detected
                _defaulted = true;
                // Add tokens to defaulted set
                _defaultTokens[_indexDefault] = c.getUnderlyingERC20();
                _indexDefault++;

                // Also mark the parent token if applies
                if (!c.isFiatcoin()) {
                    _defaultTokens[_indexDefault] = c.erc20();
                    _indexDefault++;
                }
            }
        }

        return (_defaulted, _defaultTokens);
    }

    // Get best backup vault after defaul
    // Criteria: Highest basketFiatcoinRate value, and no defaulted tokens
    function _getBestBackupVault() internal returns (IVault) {
        uint256 _maxRate;
        uint256 indexMax = 0;

        // Loop through backups to find the best
        for (uint256 i = 0; i < vault.getBackups().length; i++) {
            IVault v = vault.backupAt(i);

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

    // Add tokens to the enumerable set - Cleans it up first
    function _setDefaultedTokens(address[] memory _tokens) internal {
        _cleanupDefaultedTokens();
        for (uint256 index = 0; index < _tokens.length; index++) {
            _defaultedTokens.add(_tokens[index]);
        }
    }

    // Cleanup the enumerable set
    function _cleanupDefaultedTokens() internal {
        for (uint256 index = 0; index < _defaultedTokens.length(); index++) {
            _defaultedTokens.remove(_defaultedTokens.at(index));
        }
    }
}
