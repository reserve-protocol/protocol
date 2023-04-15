// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.17;
pragma abicoder v2;

// imports
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/// Pool contracts on other chains and managed by the Stargate protocol.
interface IStargatePool is  IERC20Metadata {
    function totalLiquidity() external view returns (uint256);
    function stopSwap() external view returns (bool);
}
