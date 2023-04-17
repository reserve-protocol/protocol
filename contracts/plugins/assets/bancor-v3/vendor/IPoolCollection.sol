// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

/**
 * @dev Pool Collection interface
 */
interface IPoolCollection {
    /**
     * @dev converts the specified pool token amount to the underlying base token amount
     */
    function poolTokenToUnderlying(address pool, uint256 poolTokenAmount)
        external
        view
        returns (uint256);

    /**
     * @dev converts the specified underlying base token amount to pool token amount
     */
    function underlyingToPoolToken(address pool, uint256 baseTokenAmount)
        external
        view
        returns (uint256);

    /**
     * @dev returns the number of pool token to burn to increase everyone's underlying value
     */
    function poolTokenAmountToBurn(
        address pool,
        uint256 baseTokenAmountToDistribute,
        uint256 protocolPoolTokenAmount
    ) external view returns (uint256);
}
