// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.7;

import { IERC20 } from "./IERC20.sol";

/// @title A standard for tokenized Vaults with a single underlying ERC-20 token.
interface IERC4626 is IERC20 {

    /**************************************************************************************************************************************/
    /*** Events                                                                                                                         ***/
    /**************************************************************************************************************************************/

    /**
     *  @dev   `caller_` has exchanged `assets_` for `shares_` and transferred them to `owner_`.
     *         MUST be emitted when assets are deposited via the `deposit` or `mint` methods.
     *  @param caller_ The caller of the function that emitted the `Deposit` event.
     *  @param owner_  The owner of the shares.
     *  @param assets_ The amount of assets deposited.
     *  @param shares_ The amount of shares minted.
     */
    event Deposit(address indexed caller_, address indexed owner_, uint256 assets_, uint256 shares_);

    /**
     *  @dev   `caller_` has exchanged `shares_`, owned by `owner_`, for `assets_`, and transferred them to `receiver_`.
     *         MUST be emitted when assets are withdrawn via the `withdraw` or `redeem` methods.
     *  @param caller_   The caller of the function that emitted the `Withdraw` event.
     *  @param receiver_ The receiver of the assets.
     *  @param owner_    The owner of the shares.
     *  @param assets_   The amount of assets withdrawn.
     *  @param shares_   The amount of shares burned.
     */
    event Withdraw(address indexed caller_, address indexed receiver_, address indexed owner_, uint256 assets_, uint256 shares_);

    /**************************************************************************************************************************************/
    /*** State Variables                                                                                                                ***/
    /**************************************************************************************************************************************/

    /**
     *  @dev    The address of the underlying asset used by the Vault.
     *          MUST be a contract that implements the ERC-20 standard.
     *          MUST NOT revert.
     *  @return asset_ The address of the underlying asset.
     */
    function asset() external view returns (address asset_);

    /**************************************************************************************************************************************/
    /*** State Changing Functions                                                                                                       ***/
    /**************************************************************************************************************************************/

    /**
     *  @dev    Mints `shares_` to `receiver_` by depositing `assets_` into the Vault.
     *          MUST emit the {Deposit} event.
     *          MUST revert if all of the assets cannot be deposited (due to insufficient approval, deposit limits, slippage, etc).
     *  @param  assets_   The amount of assets to deposit.
     *  @param  receiver_ The receiver of the shares.
     *  @return shares_   The amount of shares minted.
     */
    function deposit(uint256 assets_, address receiver_) external returns (uint256 shares_);

    /**
     *  @dev    Mints `shares_` to `receiver_` by depositing `assets_` into the Vault.
     *          MUST emit the {Deposit} event.
     *          MUST revert if all of shares cannot be minted (due to insufficient approval, deposit limits, slippage, etc).
     *  @param  shares_   The amount of shares to mint.
     *  @param  receiver_ The receiver of the shares.
     *  @return assets_   The amount of assets deposited.
     */
    function mint(uint256 shares_, address receiver_) external returns (uint256 assets_);

    /**
     *  @dev    Burns `shares_` from `owner_` and sends `assets_` to `receiver_`.
     *          MUST emit the {Withdraw} event.
     *          MUST revert if all of the shares cannot be redeemed (due to insufficient shares, withdrawal limits, slippage, etc).
     *  @param  shares_   The amount of shares to redeem.
     *  @param  receiver_ The receiver of the assets.
     *  @param  owner_    The owner of the shares.
     *  @return assets_   The amount of assets sent to the receiver.
     */
    function redeem(uint256 shares_, address receiver_, address owner_) external returns (uint256 assets_);

    /**
     *  @dev    Burns `shares_` from `owner_` and sends `assets_` to `receiver_`.
     *          MUST emit the {Withdraw} event.
     *          MUST revert if all of the assets cannot be withdrawn (due to insufficient assets, withdrawal limits, slippage, etc).
     *  @param  assets_   The amount of assets to withdraw.
     *  @param  receiver_ The receiver of the assets.
     *  @param  owner_    The owner of the assets.
     *  @return shares_   The amount of shares burned from the owner.
     */
    function withdraw(uint256 assets_, address receiver_, address owner_) external returns (uint256 shares_);

    /**************************************************************************************************************************************/
    /*** View Functions                                                                                                                 ***/
    /**************************************************************************************************************************************/

    /**
     *  @dev    The amount of `assets_` the `shares_` are currently equivalent to.
     *          MUST NOT be inclusive of any fees that are charged against assets in the Vault.
     *          MUST NOT reflect slippage or other on-chain conditions when performing the actual exchange.
     *          MUST NOT show any variations depending on the caller.
     *          MUST NOT revert.
     *  @param  shares_ The amount of shares to convert.
     *  @return assets_ The amount of equivalent assets.
     */
    function convertToAssets(uint256 shares_) external view returns (uint256 assets_);

    /**
     *  @dev    The amount of `shares_` the `assets_` are currently equivalent to.
     *          MUST NOT be inclusive of any fees that are charged against assets in the Vault.
     *          MUST NOT reflect slippage or other on-chain conditions when performing the actual exchange.
     *          MUST NOT show any variations depending on the caller.
     *          MUST NOT revert.
     *  @param  assets_ The amount of assets to convert.
     *  @return shares_ The amount of equivalent shares.
     */
    function convertToShares(uint256 assets_) external view returns (uint256 shares_);

    /**
     *  @dev    Maximum amount of `assets_` that can be deposited on behalf of the `receiver_` through a `deposit` call.
     *          MUST return a limited value if the receiver is subject to any limits, or the maximum value otherwise.
     *          MUST NOT revert.
     *  @param  receiver_ The receiver of the assets.
     *  @return assets_   The maximum amount of assets that can be deposited.
     */
    function maxDeposit(address receiver_) external view returns (uint256 assets_);

    /**
     *  @dev    Maximum amount of `shares_` that can be minted on behalf of the `receiver_` through a `mint` call.
     *          MUST return a limited value if the receiver is subject to any limits, or the maximum value otherwise.
     *          MUST NOT revert.
     *  @param  receiver_ The receiver of the shares.
     *  @return shares_   The maximum amount of shares that can be minted.
     */
    function maxMint(address receiver_) external view returns (uint256 shares_);

    /**
     *  @dev    Maximum amount of `shares_` that can be redeemed from the `owner_` through a `redeem` call.
     *          MUST return a limited value if the owner is subject to any limits, or the total amount of owned shares otherwise.
     *          MUST NOT revert.
     *  @param  owner_  The owner of the shares.
     *  @return shares_ The maximum amount of shares that can be redeemed.
     */
    function maxRedeem(address owner_) external view returns (uint256 shares_);

    /**
     *  @dev    Maximum amount of `assets_` that can be withdrawn from the `owner_` through a `withdraw` call.
     *          MUST return a limited value if the owner is subject to any limits, or the total amount of owned assets otherwise.
     *          MUST NOT revert.
     *  @param  owner_  The owner of the assets.
     *  @return assets_ The maximum amount of assets that can be withdrawn.
     */
    function maxWithdraw(address owner_) external view returns (uint256 assets_);

    /**
     *  @dev    Allows an on-chain or off-chain user to simulate the effects of their deposit at the current block, given current on-chain conditions.
     *          MUST return as close to and no more than the exact amount of shares that would be minted in a `deposit` call in the same transaction.
     *          MUST NOT account for deposit limits like those returned from `maxDeposit` and should always act as though the deposit would be accepted.
     *  @param  assets_ The amount of assets to deposit.
     *  @return shares_ The amount of shares that would be minted.
     */
    function previewDeposit(uint256 assets_) external view returns (uint256 shares_);

    /**
     *  @dev    Allows an on-chain or off-chain user to simulate the effects of their mint at the current block, given current on-chain conditions.
     *          MUST return as close to and no fewer than the exact amount of assets that would be deposited in a `mint` call in the same transaction.
     *          MUST NOT account for mint limits like those returned from `maxMint` and should always act as though the minting would be accepted.
     *  @param  shares_ The amount of shares to mint.
     *  @return assets_ The amount of assets that would be deposited.
     */
    function previewMint(uint256 shares_) external view returns (uint256 assets_);

    /**
     *  @dev    Allows an on-chain or off-chain user to simulate the effects of their redemption at the current block, given current on-chain conditions.
     *          MUST return as close to and no more than the exact amount of assets that would be withdrawn in a `redeem` call in the same transaction.
     *          MUST NOT account for redemption limits like those returned from `maxRedeem` and should always act as though the redemption would be accepted.
     *  @param  shares_ The amount of shares to redeem.
     *  @return assets_ The amount of assets that would be withdrawn.
     */
    function previewRedeem(uint256 shares_) external view returns (uint256 assets_);

    /**
     *  @dev    Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current block, given current on-chain conditions.
     *          MUST return as close to and no fewer than the exact amount of shares that would be burned in a `withdraw` call in the same transaction.
     *          MUST NOT account for withdrawal limits like those returned from `maxWithdraw` and should always act as though the withdrawal would be accepted.
     *  @param  assets_ The amount of assets to withdraw.
     *  @return shares_ The amount of shares that would be redeemed.
     */
    function previewWithdraw(uint256 assets_) external view returns (uint256 shares_);

    /**
     *  @dev    Total amount of the underlying asset that is managed by the Vault.
     *          SHOULD include compounding that occurs from any yields.
     *          MUST NOT revert.
     *  @return totalAssets_ The total amount of assets the Vault manages.
     */
    function totalAssets() external view returns (uint256 totalAssets_);

}