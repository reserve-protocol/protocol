// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

/**
 * @dev Pool Token interface
 */
interface IPoolToken{
    /**
     * @dev returns the address of the reserve token
     */
    function reserveToken() external view returns (address);

    /**
     * @dev increases the token supply and sends the new tokens to the given account
     *
     * requirements:
     *
     * - the caller must be the owner of the contract
     */
    function mint(address recipient, uint256 amount) external;
}
