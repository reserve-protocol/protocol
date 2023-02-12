// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./vendor/CometInterface.sol";
import "./WrappedERC20.sol";
import "./ICometRewards.sol";
import "./ICusdcV3Wrapper.sol";
import "./CometHelpers.sol";

/**
 * @title CusdcV3Wrapper
 * @notice Wrapper for cUSDCV3 / COMET that acts as a stable-balance ERC20, instead of rebasing
 * token. {comet} will be used as the unit for the underlying token, and {wComet} will be used
 * as the unit for wrapped tokens.
 */
contract CusdcV3Wrapper is ICusdcV3Wrapper, WrappedERC20, CometHelpers {
    using SafeERC20 for IERC20;

    /// From cUSDCv3, used in principal <> present calculations
    uint256 public constant TRACKING_INDEX_SCALE = 1e15;
    /// From cUSDCv3, scaling factor for USDC rewards
    uint64 public constant RESCALE_FACTOR = 1e12;

    CometInterface public immutable underlyingComet;
    ICometRewards public immutable rewardsAddr;
    IERC20 public immutable rewardERC20;

    /// Mapping of addresses to local account details (simplified version of Comet.UserBasic)
    mapping(address => UserBasic) public userBasic;

    constructor(
        address cusdcv3,
        address rewardsAddr_,
        address rewardERC20_
    ) WrappedERC20("Wrapped cUSDCv3", "wcUSDCv3") {
        if (cusdcv3 == address(0)) revert ZeroAddress();

        rewardsAddr = ICometRewards(rewardsAddr_);
        rewardERC20 = IERC20(rewardERC20_);
        underlyingComet = CometInterface(cusdcv3);
    }

    /// @return number of decimals
    function decimals() public pure returns (uint8) {
        return 6;
    }

    /// @param amount {Comet} The amount of cUSDCv3 to deposit
    function deposit(uint256 amount) external {
        _deposit(msg.sender, msg.sender, msg.sender, amount);
    }

    /// @param dst The dst to deposit into
    /// @param amount {Comet} The amount of cUSDCv3 to deposit
    function depositTo(address dst, uint256 amount) external {
        _deposit(msg.sender, msg.sender, dst, amount);
    }

    /// @param src The address to deposit from
    /// @param dst The address to deposit to
    /// @param amount {Comet} The amount of cUSDCv3 to deposit
    function depositFrom(
        address src,
        address dst,
        uint256 amount
    ) external {
        _deposit(msg.sender, src, dst, amount);
    }

    /// Only called internally to run the deposit logic
    /// Takes `amount` fo cUSDCv3 from `src` and deposits to `dst` account in the wrapper.
    /// @param operator The address calling the contract (msg.sender)
    /// @param src The address to deposit from
    /// @param dst The address to deposit to
    /// @param amount {Comet} The amount of cUSDCv3 to deposit
    function _deposit(
        address operator,
        address src,
        address dst,
        uint256 amount
    ) internal {
        if (!hasPermission(src, operator)) revert Unauthorized();

        underlyingComet.accrueAccount(address(this));
        underlyingComet.accrueAccount(src);

        // {Comet}
        uint256 srcBal = underlyingComet.balanceOf(src);
        if (amount > srcBal) amount = srcBal;

        if (amount == 0) return;

        UserBasic memory dstBasic = userBasic[dst];
        // {wComet}
        uint104 userPrePrincipal = dstBasic.principal;

        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        if (dstBasic.principal == 0) {
            // update reward tracking index only if user does not yet have a balance
            dstBasic.baseTrackingIndex = wrappedBasic.baseTrackingIndex;
        }

        int104 wrapperPrePrinc = wrappedBasic.principal;

        IERC20(address(underlyingComet)).safeTransferFrom(src, address(this), amount);

        wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPostPrinc = wrappedBasic.principal;

        // // safe to cast because amount is positive
        userBasic[dst] = updatedAccountIndices(
            dstBasic,
            userPrePrincipal + uint104(wrapperPostPrinc - wrapperPrePrinc)
        );
    }

    /// @param amount {Comet} The amount of cUSDCv3 to withdraw
    function withdraw(uint256 amount) external {
        _withdraw(msg.sender, msg.sender, msg.sender, amount);
    }

    /// @param dst The address to withdraw cUSDCv3 to
    /// @param amount {Comet} The amount of cUSDCv3 to withdraw
    function withdrawTo(address dst, uint256 amount) external {
        _withdraw(msg.sender, msg.sender, dst, amount);
    }

    /// @param src The address to withdraw from
    /// @param dst The address to withdraw cUSDCv3 to
    /// @param amount {Comet} The amount of cUSDCv3 to withdraw
    function withdrawFrom(
        address src,
        address dst,
        uint256 amount
    ) external {
        _withdraw(msg.sender, src, dst, amount);
    }

    /// Internally called to run the withdraw logic
    /// Withdraws `amount` cUSDCv3 from `src` account in the wrapper and sends to `dst`
    /// @dev Rounds conservatively so as not to over-withdraw from the wrapper
    /// @param operator The address calling the contract (msg.sender)
    /// @param src The address to withdraw from
    /// @param dst The address to withdraw cUSDCv3 to
    /// @param amount {Comet} The amount of cUSDCv3 to withdraw
    function _withdraw(
        address operator,
        address src,
        address dst,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        if (!hasPermission(src, operator)) revert Unauthorized();

        underlyingComet.accrueAccount(address(this));
        underlyingComet.accrueAccount(src);

        uint256 currentPresetBal = underlyingBalanceOf(src);
        if (currentPresetBal < amount) {
            amount = currentPresetBal;
        }

        UserBasic memory srcBasic = userBasic[src];
        uint104 srcPrePrinc = srcBasic.principal;
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPrePrinc = wrappedBasic.principal;

        // conservative rounding in favor of the wrapper
        IERC20(address(underlyingComet)).safeTransfer(dst, (amount / 10) * 10);

        wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPostPrinc = wrappedBasic.principal;

        uint104 srcPrincipalNew = 0;
        // occasionally comet will withdraw 1-10 more than we asked for.
        // this is ok because 9 times out of 10 we are rounding in favor of the wrapper.
        if (srcPrePrinc > uint104(wrapperPrePrinc - wrapperPostPrinc)) {
            // safe to cast because principal can't go negative, wrapper is not borrowing
            srcPrincipalNew = srcPrePrinc - uint104(wrapperPrePrinc - wrapperPostPrinc);
        }
        userBasic[src] = updatedAccountIndices(srcBasic, srcPrincipalNew);
    }

    /// Internally called to run transfer logic.
    /// Accrues rewards for `src` and `dst` before transferring value.
    function _beforeTokenTransfer(
        address src,
        address dst,
        uint256 amount
    ) internal virtual override {
        underlyingComet.accrueAccount(address(this));

        super._beforeTokenTransfer(src, dst, amount);

        UserBasic memory srcBasic = userBasic[src];
        userBasic[src] = updatedAccountIndices(srcBasic, srcBasic.principal - safe104(amount));

        UserBasic memory dstBasic = userBasic[dst];
        userBasic[dst] = updatedAccountIndices(dstBasic, dstBasic.principal + safe104(amount));
    }

    /// Get the balance of cUSDCv3 that is represented by the `accounts` wrapper value.
    /// @param account The address to calculate the cUSDCv3 balance of
    /// @return {Comet} The cUSDCv3 balance that `account` holds in the wrapper
    function underlyingBalanceOf(address account) public view returns (uint256) {
        uint256 balance = balanceOf(account);
        if (balance == 0) {
            return 0;
        }
        return convertStaticToDynamic(safe104(balance));
    }

    /// Standard ERC20 balanceOf functionality
    /// @param account The address to get the wrapper balance of
    /// @return {wComet} The wrapper balance that `account` holds
    function balanceOf(address account)
        public
        view
        override(ICusdcV3Wrapper, IERC20)
        returns (uint256)
    {
        return userBasic[account].principal;
    }

    /// Standard ERC20 totalSupply functionality
    /// @return {wComet} The total supply of the wrapper token
    function totalSupply() public view virtual override(ICusdcV3Wrapper, IERC20) returns (uint256) {
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        return unsigned256(int256(wrappedBasic.principal));
    }

    /// @return The exchange rate {comet/wComet}
    function exchangeRate() public view returns (uint256) {
        (uint64 baseSupplyIndex, ) = getUpdatedSupplyIndicies();
        return presentValueSupply(baseSupplyIndex, safe104(10**underlyingComet.decimals()));
    }

    /// @param amount The value of {wComet} to convert to {Comet}
    /// @return {Comet} The amount of cUSDCv3 represented by `amount of {wComet}
    function convertStaticToDynamic(uint104 amount) public view returns (uint256) {
        (uint64 baseSupplyIndex, ) = getUpdatedSupplyIndicies();
        return presentValueSupply(baseSupplyIndex, amount);
    }

    /// @param amount The value of {Comet} to convert to {wComet}
    /// @return {wComet} The amount of wrapped token represented by `amount` of {Comet}
    function convertDynamicToStatic(uint256 amount) public view returns (uint104) {
        (uint64 baseSupplyIndex, ) = getUpdatedSupplyIndicies();
        return principalValueSupply(baseSupplyIndex, amount);
    }

    /// Accure the cUSDCv3 account of the wrapper
    function accrue() public {
        underlyingComet.accrueAccount(address(this));
    }

    /// @param src The account to claim from
    /// @param dst The address to send claimed rewards to
    function claimTo(address src, address dst) public {
        address sender = msg.sender;
        if (!hasPermission(src, sender)) revert Unauthorized();

        accrueAccount(src);
        uint256 claimed = userBasic[src].rewardsClaimed;
        uint256 accrued = userBasic[src].baseTrackingAccrued * RESCALE_FACTOR;

        if (accrued > claimed) {
            uint256 owed = accrued - claimed;
            userBasic[src].rewardsClaimed = accrued;

            rewardsAddr.claimTo(address(underlyingComet), address(this), address(this), true);
            IERC20(rewardERC20).safeTransfer(dst, owed);
            emit RewardClaimed(src, dst, address(rewardERC20), owed);
        }
    }

    /// @param account The address to view the owed rewards of
    /// @return {reward} The amount of reward tokens owed to `account`
    function getRewardOwed(address account) external view returns (uint256) {
        UserBasic storage basic = userBasic[account];

        (, uint64 trackingSupplyIndex) = getUpdatedSupplyIndicies();

        uint256 indexDelta = uint256(trackingSupplyIndex - basic.baseTrackingIndex);
        uint256 newBaseTrackingAccrued = basic.baseTrackingAccrued +
            safe64((safe104(basic.principal) * indexDelta) / TRACKING_INDEX_SCALE);

        uint256 claimed = basic.rewardsClaimed;
        uint256 accrued = newBaseTrackingAccrued * RESCALE_FACTOR;
        uint256 owed = accrued > claimed ? accrued - claimed : 0;

        return owed;
    }

    /// @param account The address to get the current baseTrackingAccrued value of
    /// @return {reward} The total amount (including claimed) of reward token that has accrued to
    /// `account`
    function baseTrackingAccrued(address account) external view returns (uint64) {
        return userBasic[account].baseTrackingAccrued;
    }

    /// @param account The address to get the current baseTrackingIndex value of
    /// @return {1} The current baseTrackingIndex value of `account`
    function baseTrackingIndex(address account) external view returns (uint64) {
        return userBasic[account].baseTrackingIndex;
    }

    /// Internally called to get saved indicies
    /// @return baseSupplyIndex_ {1} The saved baseSupplyIndex
    /// @return trackingSupplyIndex_ {1} The saved trackingSupplyIndex
    function getSupplyIndices()
        internal
        view
        returns (uint64 baseSupplyIndex_, uint64 trackingSupplyIndex_)
    {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        baseSupplyIndex_ = totals.baseSupplyIndex;
        trackingSupplyIndex_ = totals.trackingSupplyIndex;
    }

    /// @param account The address to accrue, first in cUSDCv3, then locally
    function accrueAccount(address account) public {
        UserBasic memory basic = userBasic[account];
        underlyingComet.accrueAccount(address(this));
        userBasic[account] = updatedAccountIndices(basic, basic.principal);
    }

    /// Internally called to update the account indicies and accrued rewards for a given address
    /// @param basic The UserBasic struct for a target address
    /// @param newPrincipal The updated principal value to set on the target account
    function updatedAccountIndices(UserBasic memory basic, uint104 newPrincipal)
        internal
        view
        returns (UserBasic memory)
    {
        uint104 principal = basic.principal;
        basic.principal = newPrincipal;

        (, uint64 trackingSupplyIndex) = getSupplyIndices();

        uint256 indexDelta = uint256(trackingSupplyIndex - basic.baseTrackingIndex);
        basic.baseTrackingAccrued += safe64(
            (safe104(principal) * indexDelta) / TRACKING_INDEX_SCALE
        );
        basic.baseTrackingIndex = trackingSupplyIndex;

        return basic;
    }

    /// Internally called to get the updated supply indicies
    /// @return {1} The current baseSupplyIndex
    /// @return {1} The current trackingSupplyIndex
    function getUpdatedSupplyIndicies() internal view returns (uint64, uint64) {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        uint40 timeDelta = uint40(block.timestamp) - totals.lastAccrualTime;
        uint64 baseSupplyIndex_ = totals.baseSupplyIndex;
        uint64 trackingSupplyIndex_ = totals.trackingSupplyIndex;
        if (timeDelta > 0) {
            uint256 baseTrackingSupplySpeed = underlyingComet.baseTrackingSupplySpeed();
            uint256 utilization = underlyingComet.getUtilization();
            uint256 supplyRate = underlyingComet.getSupplyRate(utilization);
            baseSupplyIndex_ += safe64(mulFactor(baseSupplyIndex_, supplyRate * timeDelta));
            trackingSupplyIndex_ += safe64(
                divBaseWei(baseTrackingSupplySpeed * timeDelta, totals.totalSupplyBase)
            );
        }
        return (baseSupplyIndex_, trackingSupplyIndex_);
    }
}
