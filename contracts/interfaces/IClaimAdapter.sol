// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IClaimAdapter {
    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata(IERC20) external returns (address _to, bytes memory _calldata);

    /// @return The address of the ERC20 token the reward is paid in
    function rewardERC20() external view returns (IERC20);
}
