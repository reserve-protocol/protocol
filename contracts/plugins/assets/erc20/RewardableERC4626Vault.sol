// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../../interfaces/IRewardable.sol";
import "../../../vendor/oz/ERC4626.sol";
import "./RewardableERC20.sol";

/**
 * @title RewardableERC4626Vault
 * @notice A transferrable ERC4626 vault wrapping an inner position that earns rewards.
 *   Holding the vault token for a period of time earns the holder the right to
 *   their prorata share of the global rewards earned during that time.
 * @dev To inherit:
 *   - override _claimAssetRewards()
 *   - consider overriding _afterDeposit() and _beforeWithdraw()
 */
abstract contract RewardableERC4626Vault is ERC4626, RewardableERC20 {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _rewardToken
    )
        ERC4626(_asset, _name, _symbol)
        RewardableERC20(_rewardToken, _asset.decimals() + _decimalsOffset())
    {
        require(address(_rewardToken) != address(_asset), "reward and asset cannot match");
    }

    // solhint-enable no-empty-blocks

    function decimals() public view virtual override(ERC4626, ERC20) returns (uint8) {
        return ERC4626.decimals();
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(RewardableERC20, ERC20) {
        RewardableERC20._beforeTokenTransfer(from, to, amount);
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 9;
    }

    /// === Must override ===

    // function _claimAssetRewards() internal virtual;
}
