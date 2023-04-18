// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface IPoolManager {
    /*********************************************************************************************/
    /*** View Functions                                                                          */
    /*********************************************************************************************/

    /**
     *  @dev    Returns the amount of total assets.
     */
    function totalAssets() external view returns (uint256 totalAssets_);

    /**
     *  @dev    Returns the amount unrealized losses.
     */
    function unrealizedLosses() external view returns (uint256 unrealizedLosses_);
}
