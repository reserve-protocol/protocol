// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./vendor/CometInterface.sol";
import "./WrappedERC20.sol";
import "./vendor/ICometRewards.sol";
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
    uint256 public constant RESCALE_FACTOR = 1e12;

    CometInterface public immutable underlyingComet;
    ICometRewards public immutable rewardsAddr;
    IERC20 public immutable rewardERC20;

    mapping(address => uint64) public baseTrackingIndex; // uint64 for consistency with CometHelpers
    mapping(address => uint256) public baseTrackingAccrued; // uint256 to avoid overflow in L:199
    mapping(address => uint256) public rewardsClaimed;

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
    function decimals() public pure override(IERC20Metadata, WrappedERC20) returns (uint8) {
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
        if (!underlyingComet.hasPermission(src, operator)) revert Unauthorized();
        // {Comet}
        uint256 srcBal = underlyingComet.balanceOf(src);
        if (amount > srcBal) amount = srcBal;
        if (amount == 0) revert BadAmount();

        underlyingComet.accrueAccount(address(this));
        underlyingComet.accrueAccount(src);

        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPrePrinc = wrappedBasic.principal;

        IERC20(address(underlyingComet)).safeTransferFrom(src, address(this), amount);

        wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPostPrinc = wrappedBasic.principal;
        accrueAccountRewards(dst);
        // safe to cast because amount is positive
        _mint(dst, uint104(wrapperPostPrinc - wrapperPrePrinc));
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
        if (!hasPermission(src, operator)) revert Unauthorized();
        // {Comet}
        uint256 srcBalUnderlying = underlyingBalanceOf(src);
        if (srcBalUnderlying < amount) amount = srcBalUnderlying;
        if (amount == 0) revert BadAmount();

        underlyingComet.accrueAccount(address(this));
        underlyingComet.accrueAccount(src);

        uint256 srcBalPre = balanceOf(src);
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPrePrinc = wrappedBasic.principal;

        // conservative rounding in favor of the wrapper
        IERC20(address(underlyingComet)).safeTransfer(dst, (amount / 10) * 10);

        wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPostPrinc = wrappedBasic.principal;

        // safe to cast because principal can't go negative, wrapper is not borrowing
        uint256 burnAmt = uint256(uint104(wrapperPrePrinc - wrapperPostPrinc));
        // occasionally comet will withdraw 1-10 wei more than we asked for.
        // this is ok because 9 times out of 10 we are rounding in favor of the wrapper.
        // safe because we have already capped the comet withdraw amount to src underlying bal.
        // untested:
        //      difficult to trigger, depends on comet rules regarding rounding
        if (srcBalPre <= burnAmt) burnAmt = srcBalPre;

        accrueAccountRewards(src);
        _burn(src, safe104(burnAmt));
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

        accrueAccountRewards(src);
        accrueAccountRewards(dst);
    }

    function claimRewards() external {
        claimTo(msg.sender, msg.sender);
    }

    /// @param src The account to claim from
    /// @param dst The address to send claimed rewards to
    function claimTo(address src, address dst) public {
        if (!hasPermission(src, msg.sender)) revert Unauthorized();

        accrueAccount(src);
        uint256 claimed = rewardsClaimed[src];
        uint256 accrued = baseTrackingAccrued[src] * RESCALE_FACTOR;
        uint256 owed;
        if (accrued > claimed) {
            owed = accrued - claimed;
            rewardsClaimed[src] = accrued;

            rewardsAddr.claimTo(address(underlyingComet), address(this), address(this), true);

            uint256 bal = rewardERC20.balanceOf(address(this));
            if (owed > bal) owed = bal;
            rewardERC20.safeTransfer(dst, owed);
        }
        emit RewardsClaimed(rewardERC20, owed);
    }

    /// Accure the cUSDCv3 account of the wrapper
    function accrue() public {
        underlyingComet.accrueAccount(address(this));
    }

    /// @param account The address to accrue, first in cUSDCv3, then locally
    function accrueAccount(address account) public {
        underlyingComet.accrueAccount(address(this));
        accrueAccountRewards(account);
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

    /// @param account The address to view the owed rewards of
    /// @return {reward} The amount of reward tokens owed to `account`
    function getRewardOwed(address account) external view returns (uint256) {
        (, uint64 trackingSupplyIndex) = getUpdatedSupplyIndicies();

        uint256 indexDelta = uint256(trackingSupplyIndex - baseTrackingIndex[account]);
        uint256 newBaseTrackingAccrued = baseTrackingAccrued[account] +
            (safe104(balanceOf(account)) * indexDelta) /
            TRACKING_INDEX_SCALE;

        uint256 claimed = rewardsClaimed[account];
        uint256 accrued = newBaseTrackingAccrued * RESCALE_FACTOR;
        uint256 owed = accrued > claimed ? accrued - claimed : 0;

        return owed;
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

    /// Internally called to update the account indicies and accrued rewards for a given address
    /// @param account The UserBasic struct for a target address
    function accrueAccountRewards(address account) internal {
        uint256 accountBal = balanceOf(account);
        (, uint64 trackingSupplyIndex) = getSupplyIndices();
        uint256 indexDelta = uint256(trackingSupplyIndex - baseTrackingIndex[account]);

        baseTrackingAccrued[account] += (safe104(accountBal) * indexDelta) / TRACKING_INDEX_SCALE;
        baseTrackingIndex[account] = trackingSupplyIndex;
    }

    /// Internally called to get the updated supply indicies
    /// @return {1} The current baseSupplyIndex
    /// @return {1} The current trackingSupplyIndex
    function getUpdatedSupplyIndicies() internal view returns (uint64, uint64) {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        uint40 timeDelta = uint40(block.timestamp) - totals.lastAccrualTime;
        uint64 baseSupplyIndex_ = totals.baseSupplyIndex;
        uint64 trackingSupplyIndex_ = totals.trackingSupplyIndex;
        if (timeDelta != 0) {
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
