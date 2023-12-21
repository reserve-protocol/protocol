// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20, IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { IMorpho, IMorphoRewardsDistributor, IMorphoUsersLens } from "./IMorpho.sol";
import { RewardableERC4626Vault } from "../erc20/RewardableERC4626Vault.sol";

struct MorphoTokenisedDepositConfig {
    IMorpho morphoController;
    IERC20Metadata underlyingERC20;
    IERC20Metadata poolToken;
    ERC20 rewardToken;
}

abstract contract MorphoTokenisedDeposit is RewardableERC4626Vault {
    IMorpho public immutable morphoController;
    address public immutable poolToken;
    address public immutable underlying;

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
    }

    function rewardTokenBalance(address account) external returns (uint256 claimableRewards) {
        _claimAndSyncRewards();
        _syncAccount(account);
        claimableRewards = accumulatedRewards[account] - claimedRewards[account];
    }

    // solhint-disable-next-line no-empty-blocks
    function _claimAssetRewards() internal virtual override {}

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
