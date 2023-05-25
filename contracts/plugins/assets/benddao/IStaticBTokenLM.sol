// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;
pragma experimental ABIEncoderV2;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { ILendPool } from "./dependencies/interfaces/ILendPool.sol";
import { IIncentivesController } from "./dependencies/interfaces/IIncentivesController.sol";

interface IStaticBTokenLM is IERC20 {
    struct SignatureParams {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * @notice Deposits `ASSET` in the BendDAO lending protocol and mints static bTokens to msg.sender
     * @param recipient The address that will receive the static bTokens
     * @param amount The amount of underlying `ASSET` to deposit (e.g. deposit of 10 WETH)
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     * @param fromUnderlying bool
     * - `true` if the msg.sender comes with underlying tokens (e.g. WETH)
     * - `false` if the msg.sender comes already with bTokens (e.g. bendWETH)
     * @return uint256 The amount of StaticBToken minted, static balance
     **/
    function deposit(
        address recipient,
        uint256 amount,
        uint16 referralCode,
        bool fromUnderlying
    ) external returns (uint256);

    /**
     * @notice Burns `amount` of static bToken, with recipient receiving the corresponding amount of `ASSET`
     * @param recipient The address that will receive the amount of `ASSET` withdrawn from the BendDAO lending protocol
     * @param amount The amount to withdraw, in static balance of StaticBToken
     * @param toUnderlying bool
     * - `true` for the recipient to get underlying tokens (e.g. WETH)
     * - `false` for the recipient to get bTokens (e.g. bendWETH)
     * @return amountToBurn: StaticBTokens burnt, static balance
     * @return amountToWithdraw: underlying/bToken send to `recipient`, dynamic balance
     **/
    function withdraw(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external returns (uint256, uint256);

    /**
     * @notice Burns `amount` of static bToken, with recipient receiving the corresponding amount of `ASSET`
     * @param recipient The address that will receive the amount of `ASSET` withdrawn from the BendDAO lending protocol
     * @param amount The amount to withdraw, in dynamic balance of bToken/underlying asset
     * @param toUnderlying bool
     * - `true` for the recipient to get underlying tokens (e.g. WETH)
     * - `false` for the recipient to get bTokens (e.g. bendWETH)
     * @return amountToBurn: StaticBTokens burnt, static balance
     * @return amountToWithdraw: underlying/bToken send to `recipient`, dynamic balance
     **/
    function withdrawDynamicAmount(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external returns (uint256, uint256);

    /**
     * @notice Utility method to get the current bToken balance of a user from his staticBToken balance
     * @param account The address of the user
     * @return uint256 The bToken balance
     **/
    function dynamicBalanceOf(address account) external view returns (uint256);

    /**
     * @notice Converts a static amount (scaled balance on bToken) to the bToken/underlying value,
     * using the current liquidity index on BendDAO lending protocol
     * @param amount The amount to convert from
     * @return uint256 The dynamic amount
     **/
    function staticToDynamicAmount(uint256 amount) external view returns (uint256);

    /**
     * @notice Converts a bToken or underlying amount to what it is denominated on the bToken as
     * scaled balance, function of the principal and the liquidity index
     * @param amount The amount to convert from
     * @return uint256 The static (scaled) amount
     **/
    function dynamicToStaticAmount(uint256 amount) external view returns (uint256);

    /**
     * @notice Returns the BendDAO liquidity index of the underlying bToken, denominated rate here
     * as it can be considered as an ever-increasing exchange rate
     * @return The liquidity index
     **/
    function rate() external view returns (uint256);

    /**
     * @notice Claims rewards from `INCENTIVES_CONTROLLER` and updates internal accounting of rewards.
     */
    function collectAndUpdateRewards() external;

    /**
     * @notice Claim rewards and send them to a receiver
     * @param receiver The address to receive the rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewards(address receiver, bool forceUpdate) external;

    /**
     * @notice Claim rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewardsToSelf(bool forceUpdate) external;

    /**
     * @notice Get the total claimable rewards of the contract.
     * @return The current balance + pending rewards from the `_incentivesController`
     */
    function getTotalClaimableRewards() external view returns (uint256);

    /**
     * @notice Get the total claimable rewards for a user in WAD
     * @param user The address of the user
     * @return The claimable amount of rewards in WAD
     */
    function getClaimableRewards(address user) external view returns (uint256);

    /**
     * @notice The unclaimed rewards for a user in WAD
     * @param user The address of the user
     * @return The unclaimed amount of rewards in WAD
     */
    function getUnclaimedRewards(address user) external view returns (uint256);

    function getAccRewardsPerToken() external view returns (uint256);

    function getLifetimeRewardsClaimed() external view returns (uint256);

    function getLifetimeRewards() external view returns (uint256);

    function getLastRewardBlock() external view returns (uint256);

    function LEND_POOL() external view returns (ILendPool);

    function INCENTIVES_CONTROLLER() external view returns (IIncentivesController);

    function BTOKEN() external view returns (IERC20);

    function ASSET() external view returns (IERC20);

    function REWARD_TOKEN() external view returns (IERC20);

    function UNDERLYING_ASSET_ADDRESS() external view returns (address);

    function getIncentivesController() external view returns (IIncentivesController);
}
