// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/Ownable.sol"; // temporary

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
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
import "contracts/p0/SettingsP0.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";

/**
 * @title MainP0
 * @notice The central coordinator for the entire system, as well as the external interface.
 */
contract MainP0 is IMain, Ownable, Pausable, SettingsP0 {
    using SafeERC20 for IERC20;
    using Oracle for Oracle.Info;
    using FixLib for Fix;

    // timestamp -> whether rewards have been claimed.
    mapping(uint256 => bool) private rewardsClaimed;

    // Slow Issuance
    SlowIssuance[] public issuances;

    constructor(
        Oracle.Info memory oracle_,
        Config memory config_,
        IERC20 rsr_
    ) Settings(oracle_, config_, rsr_) {}

    /// This modifier runs before every function including redemption, so it must be very safe.
    modifier always() {
        checkForHardDefault();
        _;
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    function issue(uint256 amount) external override notPaused always {
        require(state == SystemState.CALM || state == SystemState.TRADING, "only during calm + trading");
        require(amount > 0, "Cannot issue zero");

        _processSlowIssuance();

        uint256 BUs = manager.toBUs(amount);

        // During SlowIssuance, BUs are created up front and held by `Main` until the issuance vests,
        // at which point the BUs are transferred to the AssetManager and RToken is minted to the issuer.
        SlowIssuance memory iss = SlowIssuance({
            vault: manager.vault(),
            amount: amount,
            BUs: BUs,
            deposits: manager.vault().tokenAmounts(BUs),
            issuer: _msgSender(),
            blockAvailableAt: _nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);

        for (uint256 i = 0; i < iss.vault.size(); i++) {
            IERC20(iss.vault.collateralAt(i).erc20()).safeTransferFrom(iss.issuer, address(this), iss.deposits[i]);
            IERC20(iss.vault.collateralAt(i).erc20()).safeApprove(address(iss.vault), iss.deposits[i]);
        }
        iss.vault.issue(address(this), iss.BUs);
        emit IssuanceStarted(issuances.length - 1, iss.issuer, iss.amount, iss.blockAvailableAt);
    }

    // Returns the future block number at which an issuance for *amount* now can complete
    function _nextIssuanceBlockAvailable(uint256 amount) internal view returns (uint256) {
        uint256 perBlock = Math.max(
            10_000 * 10**rToken.decimals(), // lower-bound: 10k whole RToken per block
            toFix(rToken.totalSupply()).mul(_config.issuanceRate).toUint()
        ); // {RToken/block}
        uint256 blockStart = issuances.length == 0 ? block.number : issuances[issuances.length - 1].blockAvailableAt;
        return Math.max(blockStart, block.number) + Math.ceilDiv(amount, perBlock);
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


    // -------- Default detection --------
    SystemState public state;
    uint256 public stateRaisedAt; // timestamp when default occurred

    function checkForHardDefault() internal view {
        ICollateral[] memory hardDefaulting = monitor.checkForHardDefault(manager.vault());
        if (hardDefaulting.length > 0) {
            manager.switchVaults(hardDefaulting);
            state = SystemState.TRADING;
            // TODO: Set stateRaisedAt?
        }
    }

    /// Performs the expensive checks for default, such as calculating VWAPs
    function noticeDefault() external override notPaused always {
        ICollateral[] memory softDefaulting = monitor.checkForSoftDefault(manager.vault(), manager.approvedFiatcoins());

        // If no defaults, walk back the default and enter CALM/TRADING
        if (softDefaulting.length == 0) {
            SystemState newState = manager.fullyCapitalized() ? SystemState.CALM : SystemState.TRADING;
            if (newState != state) {
                emit SystemStateChanged(state, newState);
                state = newState;
            }
            return;
        }

        // If state is DOUBT for >24h (default delay), switch vaults
        if (state == SystemState.DOUBT && block.timestamp >= stateRaisedAt + _config.defaultDelay) {
            manager.switchVaults(softDefaulting);
            emit SystemStateChanged(state, SystemState.TRADING);
            state = SystemState.TRADING;
        } else if (state == SystemState.CALM || state == SystemState.TRADING) {
            emit SystemStateChanged(state, SystemState.DOUBT);
            state = SystemState.DOUBT;
            stateRaisedAt = block.timestamp;
        }
    }

    // ==================================== Views ====================================

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _rewardsAdjacent(block.timestamp);
        return next;
    }

    /// @dev view
    /// @return The token quantities required to issue `amount` RToken.
    function quote(uint256 amount) external override returns (uint256[] memory) {
        return manager.vault().tokenAmounts(manager.toBUs(amount));
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() external view override returns (address[] memory erc20s) {
        erc20s = new address[](manager.vault().size());
        for (uint256 i = 0; i < manager.vault().size(); i++) {
            erc20s[i] = address(manager.vault().collateralAt(i).erc20());
        }
    }

    // -------- frequent checks... --------
    /// Runs the central auction loop
    function poke() external override notPaused always {
        require(state == SystemState.CALM || state == SystemState.TRADING, "only during calm + trading");
        _processSlowIssuance();

        if (state == SystemState.CALM) {
            (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
            if (!rewardsClaimed[prevRewards]) {
                manager.collectRevenue();
                rewardsClaimed[prevRewards] = true;
            }
        }

        SystemState newState = manager.doAuctions();
        if (newState != state) {
            emit SystemStateChanged(state, newState);
            state = newState;
        }
    }


    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuances.length; i++) {
            if (!issuances[i].processed && issuances[i].vault != manager.vault()) {
                issuances[i].vault.redeem(issuances[i].issuer, issuances[i].BUs);
                issuances[i].processed = true;
                emit IssuanceCanceled(i);
            } else if (!issuances[i].processed && issuances[i].blockAvailableAt <= block.number) {
                issuances[i].vault.setAllowance(address(manager), issuances[i].BUs);
                manager.issue(issuances[i]);
                issuances[i].processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }

    // Returns the rewards boundaries on either side of *time*.
    function _rewardsAdjacent(uint256 time) internal view returns (uint256 left, uint256 right) {
        int256 dist = (int256(time) - int256(_config.rewardStart)) % _config.rewardPeriod;
        if (dist < 0) {
            dist += _config.rewardPeriod;
        }
        return (time - uint256(dist), time + uint256(dist));
    }
}
