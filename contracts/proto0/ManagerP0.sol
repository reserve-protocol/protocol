// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
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
    uint256 auctionSize; // the size of an auction, as a fraction of backing
    uint256 issuanceRate; // the number of RToken to issue per block, as a fraction of RToken supply
    uint256 defaultThreshold; // the percent deviation required before a token is marked as in-default
    uint256 f; // The Revenue Factor: the fraction of revenue that goes to stakers

    // TODO: Revenue Distribution Map
}

contract ManagerP0 is IManager, Ownable {
    using SafeERC20 for IERC20;
    using SlowMinting for SlowMinting.Info;

    uint256 public constant SCALE = 1e18;

    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatioScaled / _basketDilutionRatioScaled
    // <RToken> = b * <Basket Unit Vector>
    // #RTokens <= #BUs / b
    // #BUs = vault.basketUnits(address(this))

    Config internal _config;
    uint256 internal _meltingRatioScaled = 1e18; // increases the base factor
    uint256 internal _basketDilutionRatioScaled = 1e18; // decreases the base factor

    uint256 public prevBasketFiatcoinRate; // the redemption value of the basket in fiatcoins last time f was updated
    uint256 public lastAuction; // timestamp of the last auction
    uint256 public melted; // how many RTokens have been melted

    // Deployed by Manager
    IRToken public rToken;
    IFaucet public faucet;
    IStakingPool public staking;

    // Pre-existing deployments
    IVault public vault;
    IOracle public oracle;

    // Append-only historical record
    IVault[] public pastVaults;
    mapping(uint256 => SlowMinting.Info) public slowMintings;
    uint256 numSlowMintings;

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
        _diluteBasket();
        _processSlowMintings();
        _;
    }

    function act() external override notPaused before {
        // Launch auctions
        // if ()
        // Closed form computation of state
        // Launch any auctions
        // 1. Trading mechanism
        // 2. Trading algorithm
    }

    function detectDefault() external override notPaused {
        // 1. Check fiatcoin redemption rates have not decreased since last time.
        // 2. Check oracle prices of fiatcoins for default
        // If default detected, then:
        //  replace vault, add old vault to `pastVaults`
    }

    function issue(uint256 amount) external override notPaused before {
        require(amount > 0, "Cannot issue zero");
        uint256 BUs = _toBUs(amount);
        uint256 issuanceRate = _issuanceRate(amount);
        uint256 numBlocks = (amount + issuanceRate - 1) / (issuanceRate);

        SlowMinting.Info storage minting = slowMintings[numSlowMintings + 1];
        minting.start(vault, amount, BUs, _msgSender(), _slowMintingEnd() + numBlocks * issuanceRate);
        numSlowMintings++;
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
        if (numSlowMintings == 0) {
            return block.timestamp;
        }
        return Math.max(block.timestamp, slowMintings[numSlowMintings - 1].availableAt);
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
        for (uint256 i = 0; i < numSlowMintings; i++) {
            if (!slowMintings[i].processed && address(slowMintings[i].vault) != address(vault)) {
                slowMintings[i].undo();
            } else if (!slowMintings[i].processed && slowMintings[i].availableAt >= block.timestamp) {
                slowMintings[i].complete();
                rToken.mint(slowMintings[i].minter, slowMintings[i].amount);
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
}
