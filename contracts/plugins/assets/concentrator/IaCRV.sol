// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IaCRV is IERC20Metadata {
    /// @dev Return the total amount of cvxCRV staked.
    function totalUnderlying() external view returns (uint256);

    /// @dev Return the total amount of minted aCRV
    function totalSupply() external view returns (uint256);

    /// @dev Harvest the pending reward and convert to cvxCRV.
    /// @param _recipient - The address of account to receive harvest bounty.
    /// @param _minimumOut - The minimum amount of cvxCRV should get.
    function harvest(address _recipient, uint256 _minimumOut) external returns (uint256);
}