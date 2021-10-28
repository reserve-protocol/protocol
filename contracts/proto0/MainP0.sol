// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./assets/RTokenAssetP0.sol";
import "./assets/RSRAssetP0.sol";
import "./assets/AAVEAssetP0.sol";
import "./assets/COMPAssetP0.sol";
import "./libraries/Oracle.sol";
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
    using Oracle for Oracle.Info;
    uint256 public constant override SCALE = 1e18;

    Config internal _config;
    Oracle.Info internal _oracle;

    IERC20 public override rsr;
    IRToken public override rToken;
    IFurnace public override furnace;
    IStakingPool public override staking;
    IAssetManager public override manager;
    IDefaultMonitor public override monitor;

    // Assets
    IAsset public override rTokenAsset;
    IAsset public override rsrAsset;
    IAsset public override compAsset;
    IAsset public override aaveAsset;

    // Pausing
    address public pauser;
    bool public override paused;

    mapping(uint256 => bool) rewardsProcessed; // timestamp of rewards

    // Default detection.
    State public state;
    uint256 public stateRaisedAt; // timestamp when default occurred

    constructor(
        Oracle.Info memory oracle_,
        Config memory config_,
        IERC20 rsr_
    ) {
        _oracle = oracle_;
        _config = config_;
        rsr = rsr_;
    }

    // This modifier runs before every function including redemption, so it needs to be very safe.
    modifier always() {
        // Check for hard default (anything that is 100% indicative of a default)
        IAsset[] memory hardDefaulting = monitor.checkForHardDefault(manager.vault());
        if (hardDefaulting.length > 0) {
            manager.switchVaults(hardDefaulting);
            state = State.RECAPITALIZING;
        }
        _;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function issue(uint256 amount) external override notPaused always {
        require(state == State.CALM || state == State.RECAPITALIZING, "only during calm + migration");
        require(amount > 0, "Cannot issue zero");
        manager.issue(_msgSender(), amount);
    }

    function redeem(uint256 amount) external override always {
        require(amount > 0, "Cannot redeem zero");
        manager.redeem(_msgSender(), amount);
    }

    // Runs auctions
    function poke() external override notPaused always {
        require(state == State.CALM || state == State.RECAPITALIZING, "only during calm + migration");
        state = manager.runAuctions();

        if (state == State.CALM) {
            (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
            if (!rewardsProcessed[prevRewards]) {
                rewardsProcessed[prevRewards] = true;
                manager.runPeriodicActions();
            }
        }
    }

    // Default check
    function noticeDefault() external override notPaused always {
        IAsset[] memory softDefaulting = monitor.checkForSoftDefault(manager.vault(), manager.approvedFiatcoinAssets());

        // If no defaults, walk back the default and enter CALM/RECAPITALIZING
        if (softDefaulting.length == 0) {
            state = manager.fullyCapitalized() ? State.CALM : State.RECAPITALIZING;
            return;
        }

        // If state is DOUBT for >24h (default delay), switch vaults
        if (state == State.DOUBT && block.timestamp >= stateRaisedAt + _config.defaultDelay) {
            manager.switchVaults(softDefaulting);
            state = State.RECAPITALIZING;
        } else if (state == State.CALM || state == State.RECAPITALIZING) {
            state = State.DOUBT;
            stateRaisedAt = block.timestamp;
        }
    }

    function pause() external {
        require(_msgSender() == pauser || _msgSender() == owner(), "only pauser or owner");
        paused = true;
    }

    function unpause() external {
        require(_msgSender() == pauser || _msgSender() == owner(), "only pauser or owner");
        paused = false;
    }

    function setPauser(address pauser_) external {
        require(_msgSender() == pauser || _msgSender() == owner(), "only pauser or owner");
        pauser = pauser_;
    }

    function setConfig(Config memory config_) external onlyOwner {
        // When f changes we need to accumulate the historical basket dilution
        if (_config.f != config_.f) {
            manager.accumulate();
        }
        _config = config_;
    }

    function setRToken(IRToken rToken_) external onlyOwner {
        rToken = rToken_;
    }

    function setMonitor(IDefaultMonitor monitor_) external onlyOwner {
        monitor = monitor_;
    }

    function setManager(IAssetManager manager_) external onlyOwner {
        manager = manager_;
    }

    function setStakingPool(IStakingPool staking_) external onlyOwner {
        staking = staking_;
    }

    function setFurnace(IFurnace furnace_) external onlyOwner {
        furnace = furnace_;
    }

    function setAssets(
        RTokenAssetP0 rToken_,
        RSRAssetP0 rsr_,
        COMPAssetP0 comp_,
        AAVEAssetP0 aave_
    ) external onlyOwner {
        rTokenAsset = rToken_;
        rsrAsset = rsr_;
        compAsset = comp_;
        aaveAsset = aave_;
    }

    // ==================================== Views ====================================

    function nextRewards() public view returns (uint256) {
        (, uint256 next) = _rewardsAdjacent(block.timestamp);
        return next;
    }

    function quoteIssue(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote issue zero");
        return manager.quote(amount);
    }

    function quoteRedeem(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return manager.quote(amount);
    }

    function consultAaveOracle(address token) external view override returns (uint256) {
        return _oracle.consultAave(token);
    }

    function consultCompoundOracle(address token) external view override returns (uint256) {
        return _oracle.consultCompound(token);
    }

    function comptroller() external view override returns (IComptroller) {
        return _oracle.compound;
    }

    // Config

    function rewardStart() external view override returns (uint256) {
        return _config.rewardStart;
    }

    function rewardPeriod() external view override returns (uint256) {
        return _config.rewardPeriod;
    }

    function auctionPeriod() external view override returns (uint256) {
        return _config.auctionPeriod;
    }

    function stakingWithdrawalDelay() external view override returns (uint256) {
        return _config.stakingWithdrawalDelay;
    }

    function defaultDelay() external view override returns (uint256) {
        return _config.defaultDelay;
    }

    function maxTradeSlippage() external view override returns (uint256) {
        return _config.maxTradeSlippage;
    }

    function auctionClearingTolerance() external view override returns (uint256) {
        return _config.auctionClearingTolerance;
    }

    function maxAuctionSize() external view override returns (uint256) {
        return _config.maxAuctionSize;
    }

    function minAuctionSize() external view override returns (uint256) {
        return _config.minAuctionSize;
    }

    function migrationChunk() external view override returns (uint256) {
        return _config.migrationChunk;
    }

    function issuanceRate() external view override returns (uint256) {
        return _config.issuanceRate;
    }

    function defaultThreshold() external view override returns (uint256) {
        return _config.defaultThreshold;
    }

    function f() external view override returns (uint256) {
        return _config.f;
    }

    // ==================================== Internal ====================================

    // Returns the rewards boundaries on either side of *time*.
    function _rewardsAdjacent(uint256 time) internal view returns (uint256 left, uint256 right) {
        int256 reps = (int256(time) - int256(_config.rewardStart)) / int256(_config.rewardPeriod);
        left = uint256(reps * int256(_config.rewardPeriod) + int256(_config.rewardStart));
        right = left + _config.rewardPeriod;
    }
}
