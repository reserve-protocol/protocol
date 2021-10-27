// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IAssetManager.sol";
import "./interfaces/IDefaultMonitor.sol";
import "./interfaces/IFurnace.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IRToken.sol";

/**
 * @title MainP0
 * @dev The central coordinator for the entire system, as well as the point of contact. 
 *
 */
contract MainP0 is IMain, Ownable {

    uint256 public constant SCALE = 1e18;

    Config internal _config;

    IERC20 public override rsr;
    IRToken public override rToken;
    IFurnace public override furnace;
    IStakingPool public override staking;
    IAssetManager public override manager;
    IDefaultMonitor public override monitor;

    address public pauser;
    bool public override paused;

    // Default detection.
    State public state;
    uint256 public stateRaisedAt; // timestamp when default occurred


    constructor(
        address owner,
        Config memory config_,
        IERC20 rsr_,
        IFurnace furnace_
    ) {
        _transferOwnership(owner);
        _config = config_;
        rsr = rsr_;
        furnace = furnace_;
    }

    // This modifier runs before every function including redemption, so it needs to be very safe.
    modifier always() {
        // Check for hard default (anything that is 100% indicative of a default)
        IAsset[] memory hardDefaulting = monitor.checkForHardDefault(manager.vault(), manager.allAssets());
        if (hardDefaulting.length > 0) {
            manager.switchVaults(hardDefaulting);
            state = STATE.MIGRATION;
        }
        _;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function issue(uint256 amount) external override notPaused always {
        require(state == STATE.CALM || state == STATE.MIGRATION, "only during calm + migration");
        require(amount > 0, "Cannot issue zero");
        manager.issue(_msgSender(), amount);
    }

    function redeem(uint256 amount) external override always {
        require(amount > 0, "Cannot redeem zero");
        manager.redeem(_msgSender(), amount);
    }

    // Runs auctions
    function poke() external override notPaused always {
        require(state == STATE.CALM || state == STATE.MIGRATION, "only during calm + migration");
        state = manager.runAuctions();
    }

    // Default check
    function noticeDefault() external override notPaused always {
        IAsset[] memory softDefaulting = monitor.checkForSoftDefault(manager.vault(), manager.fiatcoins());

        // If no defaults, walk back the default and enter CALM/MIGRATION
        if (softDefaulting.length == 0) {
            state = manager.fullyCapitalized() ? STATE.CALM : STATE.MIGRATION;
            return;
        } 

        // If state is DOUBT for >24h (default delay), switch vaults
        if (state == STATE.DOUBT && block.timestamp >= stateRaisedAt + _config.defaultDelay) {
            assetManager.switchVaults(softDefaulting);
            state = STATE.MIGRATION;
        } else if (state == STATE.CALM || STATE.MIGRATION) {
            state = STATE.DOUBT;
            stateRaisedAt = block.timestamp;
        }
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

    function setConfig(Config memory config_) external onlyOwner {
        // When f changes we need to accumulate the historical basket dilution
        if (_config.f != config_.f) {
            manager.accumulate();
        }
        _config = config_;
    }

    //

    function quoteIssue(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote issue zero");
        return manager.quote(_toBUs(amount));
    }

    function quoteRedeem(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return manager.quote(_toBUs(amount));
    }

    // Config getters

    function rewardStart() external override view returns (uint256) {
        return _config.rewardStart;
    }

    function rewardPeriod() external override view returns (uint256) {
        return _config.rewardPeriod;
    }

    function auctionPeriod() external override view returns (uint256) {
        return _config.auctionPeriod;
    }
    
    function stakingWithdrawalDelay() external override view returns (uint256) {
        return _config.stakingWithdrawalDelay;
    }

    function defaultDelay() external override view returns (uint256) {
        return _config.defaultDelay;
    }
    
    function maxTradeSlippage() external override view returns (uint256) {
        return _config.maxTradeSlippage;
    }
    
    function auctionClearingTolerance() external override view returns (uint256) {
        return _config.auctionClearingTolerance;
    }
    
    function maxAuctionSize() external override view returns (uint256) {
        return _config.maxAuctionSize;
    }
    
    function minAuctionSize() external override view returns (uint256) {
        return _config.minAuctionSize;
    }
    
    function migrationChunk() external override view returns (uint256) {
        return _config.migrationChunk;
    }
    
    function issuanceRate() external override view returns (uint256) {
        return _config.issuanceRate;
    }
    
    function defaultThreshold() external override view returns (uint256) {
        return _config.defaultThreshold;
    }
    
    function f() external override view returns (uint256) {
        return _config.f;
    }
}
