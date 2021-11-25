// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p1/assets/RTokenAssetP1.sol";
import "contracts/p1/assets/RSRAssetP1.sol";
import "contracts/p1/assets/AAVEAssetP1.sol";
import "contracts/p1/assets/COMPAssetP1.sol";
import "contracts/p1/libraries/OracleP1.sol";
import "contracts/p1/interfaces/IAssetP1.sol";
import "contracts/p1/interfaces/IAssetManagerP1.sol";
import "contracts/p1/interfaces/IDefaultMonitorP1.sol";
import "contracts/p1/interfaces/IFurnaceP1.sol";
import "contracts/p1/interfaces/IMainP1.sol";
import "contracts/p1/interfaces/IRTokenP1.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title MainP1
 * @notice The central coordinator for the entire system, as well as the external interface.
 */
// solhint-disable max-states-count
contract MainP1 is IMainP1, Ownable {
    using SafeERC20 for IERC20;
    using OracleP1 for OracleP1.Info;
    using FixLib for Fix;

    Config internal _config;
    OracleP1.Info internal _oracle;

    IERC20 public override rsr;
    IRTokenP1 public override rToken;
    IFurnaceP1 public override furnace;
    IStRSRP1 public override stRSR;
    IAssetManagerP1 public override manager;
    IDefaultMonitorP1 public override monitor;

    // Assets
    IAssetP1 public override rTokenAsset;
    IAssetP1 public override rsrAsset;
    IAssetP1 public override compAsset;
    IAssetP1 public override aaveAsset;

    // Pausing
    address public pauser;
    bool public override paused;

    // timestamp -> whether rewards have been claimed.
    mapping(uint256 => bool) private rewardsClaimed;

    // Slow Issuance
    SlowIssuance[] public issuances;

    // Default detection.
    State public state;
    uint256 public stateRaisedAt; // timestamp when default occurred

    constructor(
        OracleP1.Info memory oracle_,
        Config memory config_,
        IERC20 rsr_
    ) {
        _oracle = oracle_;
        _config = config_;
        rsr = rsr_;
        pauser = _msgSender();
    }

    /// This modifier runs before every function including redemption, so it should be very safe.
    modifier always() {
        ICollateral[] memory hardDefaulting = monitor.checkForHardDefault(manager.vault());
        if (hardDefaulting.length > 0) {
            manager.switchVaults(hardDefaulting);
            state = State.TRADING;
        }
        _;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    function issue(uint256 amount) external override notPaused always {
        require(state == State.CALM || state == State.TRADING, "only during calm + trading");
        require(amount > 0, "Cannot issue zero");

        _processSlowIssuance();

        uint256 amtBUs = manager.toBUs(amount);

        // During SlowIssuance, BUs are created up front and held by `Main` until the issuance vests,
        // at which point the BUs are transferred to the AssetManager and RToken is minted to the issuer.
        SlowIssuance memory iss = SlowIssuance({
            vault: manager.vault(),
            amount: amount,
            amtBUs: amtBUs,
            deposits: manager.vault().tokenAmounts(amtBUs),
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
    function redeem(uint256 amount) external override always {
        require(amount > 0, "Cannot redeem zero");
        if (!paused) {
            _processSlowIssuance();
        }
        manager.redeem(_msgSender(), amount);
        emit Redemption(_msgSender(), amount);
    }

    /// Runs the central auction loop
    function poke() external override notPaused always {
        require(state == State.CALM || state == State.TRADING, "only during calm + trading");
        _processSlowIssuance();

        if (state == State.CALM) {
            (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
            if (!rewardsClaimed[prevRewards]) {
                manager.collectRevenue();
                rewardsClaimed[prevRewards] = true;
            }
        }

        State newState = manager.doAuctions();
        if (newState != state) {
            emit StateChanged(state, newState);
            state = newState;
        }
    }

    /// Performs the expensive checks for default, such as calculating VWAPs
    function noticeDefault() external override notPaused always {
        ICollateral[] memory softDefaulting = monitor.checkForSoftDefault(manager.vault(), manager.approvedFiatcoins());

        // If no defaults, walk back the default and enter CALM/TRADING
        if (softDefaulting.length == 0) {
            State newState = manager.fullyCapitalized() ? State.CALM : State.TRADING;
            if (newState != state) {
                emit StateChanged(state, newState);
                state = newState;
            }
            return;
        }

        // If state is DOUBT for >24h (default delay), switch vaults
        if (state == State.DOUBT && block.timestamp >= stateRaisedAt + _config.defaultDelay) {
            manager.switchVaults(softDefaulting);
            emit StateChanged(state, State.TRADING);
            state = State.TRADING;
        } else if (state == State.CALM || state == State.TRADING) {
            emit StateChanged(state, State.DOUBT);
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
        if (_config.f.neq(config_.f)) {
            manager.accumulate();
        }
        _config = config_;
    }

    function setRToken(IRTokenP1 rToken_) external onlyOwner {
        rToken = rToken_;
    }

    function setMonitor(IDefaultMonitorP1 monitor_) external onlyOwner {
        monitor = monitor_;
    }

    function setManager(IAssetManagerP1 manager_) external onlyOwner {
        manager = manager_;
    }

    function setStRSR(IStRSRP1 stRSR_) external onlyOwner {
        stRSR = stRSR_;
    }

    function setFurnace(IFurnaceP1 furnace_) external onlyOwner {
        furnace = furnace_;
    }

    function setAssets(
        RTokenAssetP1 rToken_,
        RSRAssetP1 rsr_,
        COMPAssetP1 comp_,
        AAVEAssetP1 aave_
    ) external onlyOwner {
        rTokenAsset = rToken_;
        rsrAsset = rsr_;
        compAsset = comp_;
        aaveAsset = aave_;
    }

    // ==================================== Views ====================================

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _rewardsAdjacent(block.timestamp);
        return next;
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() external view override returns (address[] memory erc20s) {
        erc20s = new address[](manager.vault().size());
        for (uint256 i = 0; i < manager.vault().size(); i++) {
            erc20s[i] = address(manager.vault().collateralAt(i).erc20());
        }
    }

    /// @return {attoUSD/qTok} The price in attoUSD of a `qTok` on oracle `source`.
    function consultOracle(OracleP1.Source source, address token) external view override returns (Fix) {
        return _oracle.consult(source, token);
    }

    /// @return The deployment of the comptroller on this chain
    function comptroller() external view override returns (IComptroller) {
        return _oracle.compound;
    }

    /// @return The system configuration
    function config() external view override returns (Config memory) {
        return _config;
    }

    // ==================================== Internal ====================================

    // Returns the future block number at which an issuance for *amount* now can complete
    function _nextIssuanceBlockAvailable(uint256 amount) internal view returns (uint256) {
        uint256 perBlock = Math.max(
            10_000 * 10**rToken.decimals(), // lower-bound: 10k whole RToken per block
            toFix(rToken.totalSupply()).mul(_config.issuanceRate).toUint()
        ); // {RToken/block}
        uint256 blockStart = issuances.length == 0 ? block.number : issuances[issuances.length - 1].blockAvailableAt;
        return Math.max(blockStart, block.number) + Math.ceilDiv(amount, perBlock);
    }

    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuances.length; i++) {
            if (!issuances[i].processed && issuances[i].vault != manager.vault()) {
                issuances[i].vault.redeem(issuances[i].issuer, issuances[i].amtBUs);
                issuances[i].processed = true;
                emit IssuanceCanceled(i);
            } else if (!issuances[i].processed && issuances[i].blockAvailableAt <= block.number) {
                issuances[i].vault.setAllowance(address(manager), issuances[i].amtBUs);
                manager.issue(issuances[i]);
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
}

// solhint-enable max-states-count
