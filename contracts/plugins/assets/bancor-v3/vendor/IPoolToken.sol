// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @dev Pool Token interface
 */
interface IPoolToken is IERC20Metadata {
    /**
     * @dev returns the address of the reserve token
     */
    function reserveToken() external view returns (address);
}
