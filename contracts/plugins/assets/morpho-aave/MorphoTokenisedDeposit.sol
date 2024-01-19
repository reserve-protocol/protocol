// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20, IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { IMorpho, IMorphoUsersLens } from "./IMorpho.sol";
import { RewardableERC4626Vault } from "../erc20/RewardableERC4626Vault.sol";

struct MorphoTokenisedDepositConfig {
    IMorpho morphoController;
    IERC20Metadata underlyingERC20;
    IERC20Metadata poolToken;
    ERC20 rewardToken;
}

abstract contract MorphoTokenisedDeposit is RewardableERC4626Vault {
    struct MorphoTokenisedDepositRewardsAccountingState {
        uint256 totalAccumulatedBalance;
        uint256 totalPaidOutBalance;
        uint256 pendingBalance;
        uint256 availableBalance;
        uint256 remainingPeriod;
        uint256 lastSync;
    }

    uint256 private constant PAYOUT_PERIOD = 7 days;

    IMorpho public immutable morphoController;
    address public immutable poolToken;
    address public immutable underlying;

    MorphoTokenisedDepositRewardsAccountingState private state;

    constructor(MorphoTokenisedDepositConfig memory config)
        RewardableERC4626Vault(
            config.underlyingERC20,
            string.concat("Tokenised Morpho Position - ", config.poolToken.name()),
            string.concat("mrp-", config.poolToken.symbol()),
            config.rewardToken
        )
    {
        underlying = address(config.underlyingERC20);
        morphoController = config.morphoController;
        poolToken = address(config.poolToken);
        state.lastSync = uint48(block.timestamp);
    }

    function sync() external {
        _claimAndSyncRewards();
    }

    function _claimAssetRewards() internal override {
        // If we detect any new balances add it to pending and reset payout period
        uint256 totalAccumulated = state.totalPaidOutBalance + rewardToken.balanceOf(address(this));
        uint256 newlyAccumulated = totalAccumulated - state.totalAccumulatedBalance;

        uint256 timeDelta = block.timestamp - state.lastSync;
        if (timeDelta != 0 && state.remainingPeriod != 0) {
            if (timeDelta > state.remainingPeriod) {
                timeDelta = state.remainingPeriod;
            }

            uint256 amtToPayOut = (state.pendingBalance * timeDelta) / state.remainingPeriod;
            state.pendingBalance -= amtToPayOut;
            state.availableBalance += amtToPayOut;
        }

        if (newlyAccumulated != 0) {
            state.totalAccumulatedBalance = totalAccumulated;
            state.pendingBalance += newlyAccumulated;

            state.remainingPeriod = PAYOUT_PERIOD;
        } else {
            state.remainingPeriod = state.remainingPeriod < timeDelta
                ? 0
                : state.remainingPeriod - timeDelta;
        }

        state.lastSync = block.timestamp;
    }

    function _rewardTokenBalance() internal view override returns (uint256) {
        return state.availableBalance;
    }

    function _distributeReward(address account, uint256 amt) internal override {
        state.totalPaidOutBalance += amt;
        state.availableBalance -= amt;

        SafeERC20.safeTransfer(rewardToken, account, amt);
    }

    function getMorphoPoolBalance(address poolToken) internal view virtual returns (uint256);

    function totalAssets() public view virtual override returns (uint256) {
        return getMorphoPoolBalance(poolToken);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        SafeERC20.safeTransferFrom(IERC20(underlying), caller, address(this), assets);
        SafeERC20.safeApprove(IERC20(underlying), address(morphoController), assets);
        morphoController.supply(poolToken, assets);

        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 9;
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        morphoController.withdraw(poolToken, assets);

        _burn(owner, shares);
        SafeERC20.safeTransfer(IERC20(underlying), receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }
}
