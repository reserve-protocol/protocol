// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../../interfaces/IRewardable.sol";
import "../../../vendor/oz/ERC4626.sol";
import "./RewardableERC20.sol";

/**
 * @title RewardableERC20Vault
 * @notice A transferrable vault token wrapping an inner ERC4626 that earns rewards.
 *   Holding the vault token for a period of time earns the holder the right to
 *   their prorata share of the global rewards earned during that time.
 * @dev To inherit, override _claimAssetRewards()
 */
abstract contract RewardableERC20Vault is ERC4626, RewardableERC20 {
    // solhint-disable no-empty-blocks
    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _rewardToken
    ) ERC4626(_asset, _name, _symbol) RewardableERC20(_rewardToken) {}

    // solhint-enable no-empty-blocks

    function decimals() public view virtual override(ERC4626, ERC20) returns (uint8) {
        return ERC4626.decimals();
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal virtual override(RewardableERC20, ERC20) {
        _claimAndSyncRewards();
        _syncAccount(from);
        _syncAccount(to);
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 9;
    }
}
