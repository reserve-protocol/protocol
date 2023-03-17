// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./vendor/CometInterface.sol";
import "./IWrappedERC20.sol";

interface ICusdcV3Wrapper is IWrappedERC20 {
    event RewardClaimed(
        address indexed src,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    function claimTo(address src, address to) external;

    function accrue() external;

    function exchangeRate() external view returns (uint256);

    function underlyingComet() external view returns (CometInterface);
}
