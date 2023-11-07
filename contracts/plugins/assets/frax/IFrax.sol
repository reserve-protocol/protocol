// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// This interface only used in tests
interface IFrax is IERC20Metadata {
    function pool_burn_from(address, uint256) external; // only-callable by frax pools
}
