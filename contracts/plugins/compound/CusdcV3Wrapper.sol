// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./vendor/CometInterface.sol";
import "./WrappedERC20.sol";
import "./ICometRewards.sol";
import "./ICusdcV3Wrapper.sol";
import "./CometHelpers.sol";

contract CusdcV3Wrapper is ICusdcV3Wrapper, WrappedERC20, CometHelpers {
    struct UserBasic {
        uint104 principal;
        uint64 baseTrackingAccrued;
        uint64 baseTrackingIndex;
    }

    uint256 public constant TRACKING_INDEX_SCALE = 1e15;
    uint64 public constant RESCALE_FACTOR = 1e12;

    address public immutable underlying;
    IERC20 public immutable rewardERC20;
    CometInterface public immutable underlyingComet;
    ICometRewards public immutable rewardsAddr;

    mapping(address => UserBasic) public userBasic;
    mapping(address => uint256) public rewardsClaimed;

    event RewardClaimed(
        address indexed src,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    constructor(
        address cusdcv3,
        address rewardsAddr_,
        address rewardERC20_
    ) WrappedERC20("Wrapped cUSDCv3", "wcUSDCv3") {
        if (cusdcv3 == address(0)) revert ZeroAddress();

        underlying = cusdcv3;
        rewardsAddr = ICometRewards(rewardsAddr_);
        rewardERC20 = IERC20(rewardERC20_);
        underlyingComet = CometInterface(cusdcv3);
    }

    function decimals() public pure returns (uint8) {
        return 6;
    }

    function deposit(uint256 amount) external {
        _deposit(msg.sender, msg.sender, msg.sender, amount);
    }

    /**
     * @dev Allow a user to deposit underlying tokens and mint the corresponding number of wrapped
        tokens.
     */
    function depositTo(address account, uint256 amount) external {
        _deposit(msg.sender, msg.sender, account, amount);
    }

    function depositFrom(
        address from,
        address dst,
        uint256 amount
    ) external {
        _deposit(msg.sender, from, dst, amount);
    }

    function _deposit(
        address operator,
        address src,
        address dst,
        uint256 amount
    ) internal {
        if (!hasPermission(src, operator)) revert Unauthorized();

        underlyingComet.accrueAccount(address(this));
        underlyingComet.accrueAccount(src);

        uint256 srcBal = underlyingComet.balanceOf(src);
        if (amount > srcBal) amount = srcBal;

        if (amount == 0) return;

        UserBasic memory dstBasic = userBasic[dst];
        uint104 userPrePrincipal = dstBasic.principal;

        // We use this contract's baseTrackingIndex src Comet so we do not over-accrue user's
        // rewards.
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        dstBasic.baseTrackingIndex = wrappedBasic.baseTrackingIndex;
        int104 wrapperPrePrinc = wrappedBasic.principal;
        
        SafeERC20.safeTransferFrom(IERC20(address(underlyingComet)), src, address(this), amount);

        wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPostPrinc = wrappedBasic.principal;

        // safe to cast because amount is positive
        dstBasic.principal = userPrePrincipal + uint104(wrapperPostPrinc - wrapperPrePrinc);

        userBasic[dst] = dstBasic;
    }

    function withdraw(uint256 amount) external {
        _withdraw(msg.sender, msg.sender, msg.sender, amount);
    }

    function withdrawTo(address to, uint256 amount) external {
        _withdraw(msg.sender, msg.sender, to, amount);
    }

    function withdrawFrom(
        address src,
        address to,
        uint256 amount
    ) external {
        _withdraw(msg.sender, src, to, amount);
    }

    function _withdraw(
        address operator,
        address src,
        address dst,
        uint256 presentWithdrawAmt
    ) internal {
        if (presentWithdrawAmt == 0) return;
        if (!hasPermission(src, operator)) revert Unauthorized();

        underlyingComet.accrueAccount(address(this));
        underlyingComet.accrueAccount(src);

        uint256 currentPresetBal = underlyingBalanceOf(src);
        if (currentPresetBal < presentWithdrawAmt) {
            presentWithdrawAmt = currentPresetBal;
        }
        if (presentWithdrawAmt == 0) {
            return;
        }

        UserBasic memory srcBasic = userBasic[src];
        uint104 srcPrePrinc = srcBasic.principal;
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPrePrinc = wrappedBasic.principal;

        // conservative rounding in favor of the wrapper
        SafeERC20.safeTransfer(IERC20(address(underlyingComet)), dst, presentWithdrawAmt / 10 * 10);

        wrappedBasic = underlyingComet.userBasic(address(this));
        int104 wrapperPostPrinc = wrappedBasic.principal;

        // safe to cast because principal can't go negative, wrapper is not borrowing
        uint104 srcPrincipalNew = 0;
        if (srcPrePrinc > uint104(wrapperPrePrinc - wrapperPostPrinc)) {
            srcPrincipalNew = srcPrePrinc - uint104(wrapperPrePrinc - wrapperPostPrinc);
        }
        userBasic[src] = updatedAccountIndices(srcBasic, srcPrincipalNew);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        underlyingComet.accrueAccount(address(this));

        super._beforeTokenTransfer(from, to, amount);

        UserBasic memory fromBasic = userBasic[from];
        userBasic[from] = updatedAccountIndices(fromBasic, fromBasic.principal - safe104(amount));

        UserBasic memory toBasic = userBasic[to];
        userBasic[to] = updatedAccountIndices(toBasic, toBasic.principal + safe104(amount));
    }

    function underlyingBalanceOf(address account) public view returns (uint256) {
        uint256 balance = balanceOf(account);
        if (balance == 0) {
            return 0;
        }
        return convertStaticToDynamic(safe104(balance));
    }

    function balanceOf(address account)
        public
        view
        override(ICusdcV3Wrapper, IERC20)
        returns (uint256)
    {
        return userBasic[account].principal;
    }

    function totalSupply() public view virtual override(ICusdcV3Wrapper, IERC20) returns (uint256) {
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        return unsigned256(int256(wrappedBasic.principal));
    }

    function exchangeRate() public view returns (uint256) {
        (uint64 baseSupplyIndex, ) = getUpdatedSupplyIndicies();
        return presentValueSupply(baseSupplyIndex, safe104(10**underlyingComet.decimals()));
    }

    function convertStaticToDynamic(uint104 amount) public view returns (uint256) {
        (uint64 baseSupplyIndex, ) = getUpdatedSupplyIndicies();
        return presentValueSupply(baseSupplyIndex, amount);
    }

    function convertDynamicToStatic(uint256 amount) public view returns (uint104) {
        (uint64 baseSupplyIndex, ) = getUpdatedSupplyIndicies();
        return principalValueSupply(baseSupplyIndex, amount);
    }

    function accrue() public {
        underlyingComet.accrueAccount(address(underlyingComet));
    }

    function claimTo(address src, address to) external {
        address sender = msg.sender;
        if (!hasPermission(src, sender)) revert Unauthorized();

        accrueAccount(src);
        uint256 claimed = rewardsClaimed[src];
        uint256 accrued = userBasic[src].baseTrackingAccrued * RESCALE_FACTOR;

        if (accrued > claimed) {
            uint256 owed = accrued - claimed;
            rewardsClaimed[src] = accrued;

            emit RewardClaimed(src, to, address(rewardERC20), owed);
            rewardsAddr.claimTo(underlying, address(this), address(this), true);
            SafeERC20.safeTransfer(rewardERC20, to, owed);
        }
    }

    function getRewardOwed(address account) external returns (uint256) {
        accrueAccount(account);

        uint256 claimed = rewardsClaimed[account];
        uint256 accrued = userBasic[account].baseTrackingAccrued * RESCALE_FACTOR;
        uint256 owed = accrued > claimed ? accrued - claimed : 0;

        return owed;
    }

    function baseTrackingAccrued(address account) external view returns (uint64) {
        return userBasic[account].baseTrackingAccrued;
    }

    function baseTrackingIndex(address account) external view returns (uint64) {
        return userBasic[account].baseTrackingIndex;
    }

    function getSupplyIndices()
        internal
        view
        returns (uint64 baseSupplyIndex_, uint64 trackingSupplyIndex_)
    {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        baseSupplyIndex_ = totals.baseSupplyIndex;
        trackingSupplyIndex_ = totals.trackingSupplyIndex;
    }

    function getUpdatedSupplyIndicies()
        internal
        view
        returns (uint64 baseSupplyIndex_, uint64 trackingSupplyIndex_)
    {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        uint40 timeDelta = uint40(block.timestamp) - totals.lastAccrualTime;
        return accruedInterestIndices(timeDelta);
    }

    function accrueAccount(address account) public {
        UserBasic memory basic = userBasic[account];
        underlyingComet.accrueAccount(address(this));
        userBasic[account] = updatedAccountIndices(basic, basic.principal);
    }

    function updatedAccountIndices(UserBasic memory basic, uint104 newPrincipal)
        internal
        view
        returns (UserBasic memory)
    {
        // UserBasic memory basic = userBasic[user];

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

    /**
     * @dev Calculate accrued interest indices for base token supply and borrows
     **/
    function accruedInterestIndices(uint256 timeElapsed) internal view returns (uint64, uint64) {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        uint64 baseSupplyIndex_ = totals.baseSupplyIndex;
        uint64 baseBorrowIndex_ = totals.baseBorrowIndex;
        if (timeElapsed > 0) {
            uint256 utilization = underlyingComet.getUtilization();
            uint256 supplyRate = underlyingComet.getSupplyRate(utilization);
            uint256 borrowRate = underlyingComet.getBorrowRate(utilization);
            baseSupplyIndex_ += safe64(mulFactor(baseSupplyIndex_, supplyRate * timeElapsed));
            baseBorrowIndex_ += safe64(mulFactor(baseBorrowIndex_, borrowRate * timeElapsed));
        }
        return (baseSupplyIndex_, baseBorrowIndex_);
    }
}
