// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IMaplePool is IERC20Metadata {

    /*********************************************************************************************/
    /*** State Changing Functions                                                                */
    /*********************************************************************************************/

    /**
     *  @dev    Mints `shares_` to `receiver_` by depositing `assets_` into the Vault.
     */
     function deposit(uint256 assets_, address receiver_) external returns (uint256 shares_);

    /**************************************************************************************************************************************/
    /*** View Functions                                                                                                                 ***/
    /**************************************************************************************************************************************/

    /**
     *  @dev    The address of the account that is allowed to update the vesting schedule.
     */
    function manager() external view returns (address manager_);

    /**
     *  @dev    The amount of `assets_` the `shares_` are currently equivalent to.
     */
    function convertToAssets(uint256 shares_) external view returns (uint256 assets_);

    /**
     *  @dev    The amount of `shares_` the `assets_` are currently equivalent to.
     */
    function convertToShares(uint256 assets_) external view returns (uint256 shares_);

    /**
     *  @dev    Returns the amount of exit assets for the input amount.
     */
    function convertToExitAssets(uint256 shares_) external view returns (uint256 assets_);

    /**
     *  @dev    Returns the amount of exit shares for the input amount.
     */
    function convertToExitShares(uint256 assets_) external view returns (uint256 shares_);

    /**
     *  @dev    Returns the amount unrealized losses.
     */
    function unrealizedLosses() external view returns (uint256 unrealizedLosses_);

}