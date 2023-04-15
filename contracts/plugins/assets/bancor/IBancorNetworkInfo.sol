// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

struct WithdrawalAmounts {
    uint256 totalAmount;
    uint256 baseTokenAmount;
    uint256 bntAmount;
}

interface IBancorNetworkInfo {
    /**
     * @dev converts the specified underlying base token amount to pool token amount
     */
    function underlyingToPoolToken(address pool, uint256 tokenAmount) external view returns (uint256);
    /**
     * @dev returns the amounts that would be returned if the position is currently withdrawn,
     * along with the breakdown of the base token and the BNT compensation
     */
    function withdrawalAmounts(address pool, uint256 poolTokenAmount) external view returns (WithdrawalAmounts memory);
}
