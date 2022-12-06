// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IaFXS is IERC20Metadata {
    /// @dev Return the total amount of underlying assert mananged by the contract.
    function totalAssets() external view returns (uint256);

    /// @dev Return the total amount of minted aFXS
    function totalSupply() external view returns (uint256);

    /// @dev Harvest the pending reward and convert to cvxFXS.
    /// @param _recipient - The address of account to receive harvest bounty.
    /// @param _minAssets - The minimum amount of cvxFXS should get.
    function harvest(address _recipient, uint256 _minAssets) external returns (uint256);
}