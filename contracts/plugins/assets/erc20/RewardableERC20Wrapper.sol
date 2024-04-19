// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./RewardableERC20.sol";

/**
 * @title RewardableERC20Wrapper
 * @notice A transferrable ERC20 wrapper token wrapping an inner position that earns rewards.
 * @dev To inherit:
 *   - override _claimAssetRewards()
 *   - consider overriding _afterDeposit() and _beforeWithdraw()
 */
abstract contract RewardableERC20Wrapper is RewardableERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;

    uint8 private immutable underlyingDecimals;

    event Deposited(address indexed _user, address indexed _account, uint256 _amount);
    event Withdrawn(address indexed _user, address indexed _account, uint256 _amount);

    /// @dev Extending class must ensure ERC20 constructor is called
    constructor(
        IERC20Metadata _underlying,
        string memory _name,
        string memory _symbol,
        IERC20 _rewardToken
    ) ERC20(_name, _symbol) RewardableERC20(_rewardToken, _underlying.decimals()) {
        require(
            address(_rewardToken) != address(_underlying),
            "reward and underlying cannot match"
        );
        underlying = _underlying;
        underlyingDecimals = _underlying.decimals();
    }

    function decimals() public view virtual override returns (uint8) {
        return underlyingDecimals;
    }

    /// Deposit the underlying token and optionally take an action such as staking in a gauge
    function deposit(uint256 _amount, address _to) external virtual {
        if (_amount != 0) {
            _mint(_to, _amount); // does balance checkpointing
            underlying.safeTransferFrom(msg.sender, address(this), _amount);
            _afterDeposit(_amount, _to);
        }

        emit Deposited(msg.sender, _to, _amount);
    }

    /// Withdraw the underlying token and optionally take an action such as staking in a gauge
    function withdraw(uint256 _amount, address _to) external virtual {
        if (_amount != 0) {
            _burn(msg.sender, _amount); // does balance checkpointing
            _beforeWithdraw(_amount, _to);
            underlying.safeTransfer(_to, _amount);
        }

        emit Withdrawn(msg.sender, _to, _amount);
    }

    /// === Must override ===

    // function _claimAssetRewards() internal virtual;

    /// === May override ===
    // solhint-disable no-empty-blocks

    /// Any steps that should be taken after deposit, such as staking in a gauge
    function _afterDeposit(uint256 _amount, address to) internal virtual {}

    /// Any steps that should be taken before withdraw, such as unstaking from a gauge
    function _beforeWithdraw(uint256 _amount, address to) internal virtual {}
}
