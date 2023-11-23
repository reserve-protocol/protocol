// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20, IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { IMorpho, IMorphoRewardsDistributor, IMorphoUsersLens } from "./IMorpho.sol";
import { RewardableERC4626Vault } from "../erc20/RewardableERC4626Vault.sol";

struct MorphoTokenisedDepositConfig {
    IMorpho morphoController;
    IMorphoRewardsDistributor rewardsDistributor;
    IERC20Metadata underlyingERC20;
    IERC20Metadata poolToken;
    ERC20 rewardToken;
}

abstract contract MorphoTokenisedDeposit is RewardableERC4626Vault {
    // Sizes are picked such that the whole struct is 512 bits and can fit into 2 storage slots
    struct MorphoTokenisedDepositRewardsAccountingState {
        uint112 totalAccumulatedBalance;
        uint112 totalPaidOutBalance;
        uint120 pendingBalance;
        uint120 availableBalance;
        uint48 lastSync;
    }

    uint256 private constant PAYOUT_PERIOD = 7200;

    IMorphoRewardsDistributor public immutable rewardsDistributor;
    IMorpho public immutable morphoController;
    address public immutable poolToken;
    address public immutable underlying;

    MorphoTokenisedDepositRewardsAccountingState private _state;

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
        rewardsDistributor = config.rewardsDistributor;
        _state.lastSync = uint48(block.number);
    }

    function sync() external {
        _claimAndSyncRewards();
    }

    function _claimAssetRewards() internal override {
        MorphoTokenisedDepositRewardsAccountingState memory state = _state;
        // First pay out any pendingBalances, over a 7200 block period
        uint256 blockDelta = block.number - state.lastSync;
        if (blockDelta == 0) {
            return;
        }
        if (blockDelta > PAYOUT_PERIOD) {
            blockDelta = PAYOUT_PERIOD;
        }
        uint112 amtToPayOut = uint112(
            (uint256(state.pendingBalance) * ((blockDelta * 1e18) / PAYOUT_PERIOD)) / 1e18
        );
        state.pendingBalance -= amtToPayOut;
        state.availableBalance += amtToPayOut;

        // If we detect any new balances add it to pending and reset payout period
        uint256 newAccumulated = state.totalPaidOutBalance + rewardToken.balanceOf(address(this));
        uint256 accumulatedTokens = newAccumulated - state.totalAccumulatedBalance;
        state.totalAccumulatedBalance = uint112(newAccumulated);
        state.pendingBalance += uint120(accumulatedTokens);

        if (accumulatedTokens > 0) {
            state.lastSync = uint48(block.number);
        }
        _state = state;
    }

    function _rewardTokenBalance() internal view override returns (uint256) {
        return _state.availableBalance;
    }

    function _distributeReward(address account, uint256 amt) internal override {
        MorphoTokenisedDepositRewardsAccountingState memory state = _state;
        state.totalPaidOutBalance += uint112(amt);
        state.availableBalance -= uint120(amt);
        _state = state;
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
