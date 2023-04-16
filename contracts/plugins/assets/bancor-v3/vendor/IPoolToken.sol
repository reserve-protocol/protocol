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

    /**
     * @dev increases the token supply and sends the new tokens to the given account
     */
    function mint(address recipient, uint256 amount) external;

    /**
     * @dev Destroys tokens from the caller.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Destroys tokens from a recipient, deducting from the caller's allowance
     */
    function burnFrom(address recipient, uint256 amount) external;
}
