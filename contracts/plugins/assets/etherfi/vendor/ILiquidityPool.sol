// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// External interface for Ether.fi's LiquidityPool contract
interface ILiquidityPool {
    function amountForShare(uint256 _share) external view returns (uint256);

    function sharesForAmount(uint256 _amount) external view returns (uint256);

    function getTotalPooledEther() external view returns (uint256);

    function rebase(int128 _accruedRewards) external;
}
