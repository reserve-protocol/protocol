// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;
pragma experimental ABIEncoderV2;

import { ILendPool } from "./dependencies/interfaces/ILendPool.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";

import { IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { IBToken } from "./dependencies/interfaces/IBToken.sol";
import { IStaticBTokenLM } from "./IStaticBTokenLM.sol";
import { IIncentivesController } from "./dependencies/interfaces/IIncentivesController.sol";
import { IScaledBalanceToken } from "./dependencies/interfaces/IScaledBalanceToken.sol";

import { StaticBTokenErrors } from "./StaticBTokenErrors.sol";

import { ERC20 } from "./ERC20.sol";
import { ReentrancyGuard } from "./ReentrancyGuard.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { WadRayMath } from "./dependencies/libraries/WadRayMath.sol";
import { RayMathNoRounding } from "./RayMathNoRounding.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title StaticBTokenLM
 * @notice Wrapper token that allows to deposit tokens on the Aave protocol and receive
 * a token which balance doesn't increase automatically, but uses an ever-increasing exchange rate.
 * The token support claiming liquidity mining rewards from the Aave system.
 **/
contract StaticBTokenLM is
    ReentrancyGuard,
    ERC20("STATIC_BTOKEN_IMPL", "STATIC_BTOKEN_IMPL"),
    IStaticBTokenLM
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using WadRayMath for uint256;
    using RayMathNoRounding for uint256;

    ILendPool public override LEND_POOL;
    IIncentivesController public override INCENTIVES_CONTROLLER;
    IERC20 public override BTOKEN;
    IERC20 public override ASSET;
    IERC20 public override REWARD_TOKEN;

    uint256 internal _accRewardsPerToken;
    uint256 internal _lifetimeRewardsClaimed;
    uint256 internal _lifetimeRewards;
    uint256 internal _lastRewardBlock;

    // user => _accRewardsPerToken at last interaction (in RAYs)
    mapping(address => uint256) private _userSnapshotRewardsPerToken;
    // user => unclaimedRewards (in RAYs)
    mapping(address => uint256) private _unclaimedRewards;

    constructor(
        ILendPool pool,
        address bToken,
        string memory staticBTokenName,
        string memory staticBTokenSymbol
    ) public {
        LEND_POOL = pool;
        BTOKEN = IERC20(bToken);

        _name = staticBTokenName;
        _symbol = staticBTokenSymbol;
        _setupDecimals(IERC20Metadata(bToken).decimals());

        try IBToken(bToken).getIncentivesController() returns (
            IIncentivesController incentivesController
        ) {
            if (address(incentivesController) != address(0)) {
                INCENTIVES_CONTROLLER = incentivesController;
                REWARD_TOKEN = IERC20(address(INCENTIVES_CONTROLLER.REWARD_TOKEN()));
            }
        } catch {}

        ASSET = IERC20(IBToken(bToken).UNDERLYING_ASSET_ADDRESS());
        ASSET.safeApprove(address(pool), type(uint256).max);
    }

    ///@inheritdoc IStaticBTokenLM
    function deposit(
        address recipient,
        uint256 amount,
        uint16 referralCode,
        bool fromUnderlying
    ) external override nonReentrant returns (uint256) {
        return _deposit(msg.sender, recipient, amount, referralCode, fromUnderlying);
    }

    ///@inheritdoc IStaticBTokenLM
    function withdraw(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external override nonReentrant returns (uint256, uint256) {
        return _withdraw(msg.sender, recipient, amount, 0, toUnderlying);
    }

    ///@inheritdoc IStaticBTokenLM
    function withdrawDynamicAmount(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external override nonReentrant returns (uint256, uint256) {
        return _withdraw(msg.sender, recipient, 0, amount, toUnderlying);
    }

    ///@inheritdoc IStaticBTokenLM
    function dynamicBalanceOf(address account) external view override returns (uint256) {
        return _staticToDynamicAmount(balanceOf(account), rate());
    }

    ///@inheritdoc IStaticBTokenLM
    function staticToDynamicAmount(uint256 amount) external view override returns (uint256) {
        return _staticToDynamicAmount(amount, rate());
    }

    ///@inheritdoc IStaticBTokenLM
    function dynamicToStaticAmount(uint256 amount) external view override returns (uint256) {
        return _dynamicToStaticAmount(amount, rate());
    }

    ///@inheritdoc IStaticBTokenLM
    function rate() public view override returns (uint256) {
        return LEND_POOL.getReserveNormalizedIncome(address(ASSET));
    }

    function _dynamicToStaticAmount(uint256 amount, uint256 rate_) internal pure returns (uint256) {
        return amount.rayDiv(rate_);
    }

    function _staticToDynamicAmount(uint256 amount, uint256 rate_) internal pure returns (uint256) {
        return amount.rayMul(rate_);
    }

    function _deposit(
        address depositor,
        address recipient,
        uint256 amount,
        uint16 referralCode,
        bool fromUnderlying
    ) internal returns (uint256) {
        require(recipient != address(0), StaticBTokenErrors.INVALID_RECIPIENT);
        _updateRewards();

        if (fromUnderlying) {
            ASSET.safeTransferFrom(depositor, address(this), amount);
            LEND_POOL.deposit(address(ASSET), amount, address(this), referralCode);
        } else {
            BTOKEN.safeTransferFrom(depositor, address(this), amount);
        }

        uint256 amountToMint = _dynamicToStaticAmount(amount, rate());
        _mint(recipient, amountToMint);

        return amountToMint;
    }

    function _withdraw(
        address owner,
        address recipient,
        uint256 staticAmount,
        uint256 dynamicAmount,
        bool toUnderlying
    ) internal returns (uint256, uint256) {
        require(recipient != address(0), StaticBTokenErrors.INVALID_RECIPIENT);
        require(
            staticAmount == 0 || dynamicAmount == 0,
            StaticBTokenErrors.ONLY_ONE_AMOUNT_FORMAT_ALLOWED
        );
        _updateRewards();

        uint256 userBalance = balanceOf(owner);

        uint256 amountToWithdraw;
        uint256 amountToBurn;

        uint256 currentRate = rate();
        if (staticAmount > 0) {
            amountToBurn = (staticAmount > userBalance) ? userBalance : staticAmount;
            amountToWithdraw = _staticToDynamicAmount(amountToBurn, currentRate);
        } else {
            uint256 dynamicUserBalance = _staticToDynamicAmount(userBalance, currentRate);
            amountToWithdraw = (dynamicAmount > dynamicUserBalance)
                ? dynamicUserBalance
                : dynamicAmount;
            amountToBurn = _dynamicToStaticAmount(amountToWithdraw, currentRate);
        }

        _burn(owner, amountToBurn);

        if (toUnderlying) {
            uint256 amt = LEND_POOL.withdraw(address(ASSET), amountToWithdraw, recipient);
            assert(amt == amountToWithdraw);
        } else {
            BTOKEN.safeTransfer(recipient, amountToWithdraw);
        }

        return (amountToBurn, amountToWithdraw);
    }

    /**
     * @notice Updates rewards for senders and receiver in a transfer (not updating rewards for address(0))
     * @param from The address of the sender of tokens
     * @param to The address of the receiver of tokens
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal override {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return;
        }
        if (from != address(0)) {
            _updateUser(from);
        }
        if (to != address(0)) {
            _updateUser(to);
        }
    }

    /**
     * @notice Updates virtual internal accounting of rewards.
     */
    function _updateRewards() internal {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return;
        }
        if (block.number > _lastRewardBlock) {
            _lastRewardBlock = block.number;
            uint256 supply = totalSupply();
            if (supply == 0) {
                // No rewards can have accrued since last because there were no funds.
                return;
            }

            IScaledBalanceToken[] memory assets = new IScaledBalanceToken[](1);
            assets[0] = IScaledBalanceToken(address(BTOKEN));

            uint256 freshRewards = INCENTIVES_CONTROLLER.getRewardsBalance(assets, address(this));
            uint256 lifetimeRewards = _lifetimeRewardsClaimed.add(freshRewards);
            uint256 rewardsAccrued = lifetimeRewards.sub(_lifetimeRewards).wadToRay();

            _accRewardsPerToken = _accRewardsPerToken.add(
                (rewardsAccrued).rayDivNoRounding(supply.wadToRay())
            );
            _lifetimeRewards = lifetimeRewards;
        }
    }

    function _collectAndUpdateRewards() internal {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return;
        }

        _lastRewardBlock = block.number;
        uint256 supply = totalSupply();

        IScaledBalanceToken[] memory assets = new IScaledBalanceToken[](1);
        assets[0] = IScaledBalanceToken(address(BTOKEN));

        uint256 freshlyClaimed = INCENTIVES_CONTROLLER.claimRewards(
            assets,
            type(uint256).max
        );
        uint256 lifetimeRewards = _lifetimeRewardsClaimed.add(freshlyClaimed);
        uint256 rewardsAccrued = lifetimeRewards.sub(_lifetimeRewards).wadToRay();

        if (supply > 0 && rewardsAccrued > 0) {
            _accRewardsPerToken = _accRewardsPerToken.add(
                (rewardsAccrued).rayDivNoRounding(supply.wadToRay())
            );
        }

        if (rewardsAccrued > 0) {
            _lifetimeRewards = lifetimeRewards;
        }

        _lifetimeRewardsClaimed = lifetimeRewards;
    }

    ///@inheritdoc IStaticBTokenLM
    function collectAndUpdateRewards() external override nonReentrant {
        _collectAndUpdateRewards();
    }

    /**
     * @notice Claim rewards on behalf of a user and send them to a receiver
     * @param onBehalfOf The address to claim on behalf of
     * @param receiver The address to receive the rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function _claimRewardsOnBehalf(
        address onBehalfOf,
        address receiver,
        bool forceUpdate
    ) internal {
        if (forceUpdate) {
            _collectAndUpdateRewards();
        }

        uint256 balance = balanceOf(onBehalfOf);
        uint256 reward = _getClaimableRewards(onBehalfOf, balance, false);
        uint256 totBal = REWARD_TOKEN.balanceOf(address(this));
        if (reward > totBal) {
            reward = totBal;
        }
        if (reward > 0) {
            _unclaimedRewards[onBehalfOf] = 0;
            _updateUserSnapshotRewardsPerToken(onBehalfOf);
            REWARD_TOKEN.safeTransfer(receiver, reward);
        }
    }

    ///@inheritdoc IStaticBTokenLM
    function claimRewards(address receiver, bool forceUpdate) external override nonReentrant {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return;
        }
        _claimRewardsOnBehalf(msg.sender, receiver, forceUpdate);
    }

    ///@inheritdoc IStaticBTokenLM
    function claimRewardsToSelf(bool forceUpdate) external override nonReentrant {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return;
        }
        _claimRewardsOnBehalf(msg.sender, msg.sender, forceUpdate);
    }

    /**
     * @notice Update the rewardDebt for a user with balance as his balance
     * @param user The user to update
     */
    function _updateUserSnapshotRewardsPerToken(address user) internal {
        _userSnapshotRewardsPerToken[user] = _accRewardsPerToken;
    }

    /**
     * @notice Adding the pending rewards to the unclaimed for specific user and updating user index
     * @param user The address of the user to update
     */
    function _updateUser(address user) internal {
        uint256 balance = balanceOf(user);
        if (balance > 0) {
            uint256 pending = _getPendingRewards(user, balance, false);
            _unclaimedRewards[user] = _unclaimedRewards[user].add(pending);
        }
        _updateUserSnapshotRewardsPerToken(user);
    }

    /**
     * @notice Compute the pending in RAY (rounded down). Pending is the amount to add (not yet unclaimed) rewards in RAY (rounded down).
     * @param user The user to compute for
     * @param balance The balance of the user
     * @param fresh Flag to account for rewards not claimed by contract yet
     * @return The amound of pending rewards in RAY
     */
    function _getPendingRewards(
        address user,
        uint256 balance,
        bool fresh
    ) internal view returns (uint256) {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return 0;
        }

        if (balance == 0) {
            return 0;
        }

        uint256 rayBalance = balance.wadToRay();

        uint256 supply = totalSupply();
        uint256 accRewardsPerToken = _accRewardsPerToken;

        if (supply != 0 && fresh) {
            IScaledBalanceToken[] memory assets = new IScaledBalanceToken[](1);
            assets[0] = IScaledBalanceToken(address(BTOKEN));

            uint256 freshReward = INCENTIVES_CONTROLLER.getRewardsBalance(assets, address(this));
            uint256 lifetimeRewards = _lifetimeRewardsClaimed.add(freshReward);
            uint256 rewardsAccrued = lifetimeRewards.sub(_lifetimeRewards).wadToRay();
            accRewardsPerToken = accRewardsPerToken.add(
                (rewardsAccrued).rayDivNoRounding(supply.wadToRay())
            );
        }

        return
            rayBalance.rayMulNoRounding(accRewardsPerToken.sub(_userSnapshotRewardsPerToken[user]));
    }

    /**
     * @notice Compute the claimable rewards for a user
     * @param user The address of the user
     * @param balance The balance of the user in WAD
     * @param fresh Flag to account for rewards not claimed by contract yet
     * @return The total rewards that can be claimed by the user (if `fresh` flag true, after updating rewards)
     */
    function _getClaimableRewards(
        address user,
        uint256 balance,
        bool fresh
    ) internal view returns (uint256) {
        uint256 reward = _unclaimedRewards[user].add(_getPendingRewards(user, balance, fresh));
        return reward.rayToWadNoRounding();
    }

    ///@inheritdoc IStaticBTokenLM
    function getTotalClaimableRewards() external view override returns (uint256) {
        if (address(INCENTIVES_CONTROLLER) == address(0)) {
            return 0;
        }

        IScaledBalanceToken[] memory assets = new IScaledBalanceToken[](1);
        assets[0] = IScaledBalanceToken(address(BTOKEN));
        uint256 freshRewards = INCENTIVES_CONTROLLER.getRewardsBalance(assets, address(this));
        return REWARD_TOKEN.balanceOf(address(this)).add(freshRewards);
    }

    ///@inheritdoc IStaticBTokenLM
    function getClaimableRewards(address user) external view override returns (uint256) {
        return _getClaimableRewards(user, balanceOf(user), true);
    }

    ///@inheritdoc IStaticBTokenLM
    function getUnclaimedRewards(address user) external view override returns (uint256) {
        return _unclaimedRewards[user].rayToWadNoRounding();
    }

    function getAccRewardsPerToken() external view override returns (uint256) {
        return _accRewardsPerToken;
    }

    function getLifetimeRewardsClaimed() external view override returns (uint256) {
        return _lifetimeRewardsClaimed;
    }

    function getLifetimeRewards() external view override returns (uint256) {
        return _lifetimeRewards;
    }

    function getLastRewardBlock() external view override returns (uint256) {
        return _lastRewardBlock;
    }

    function getIncentivesController() external view override returns (IIncentivesController) {
        return INCENTIVES_CONTROLLER;
    }

    function UNDERLYING_ASSET_ADDRESS() external view override returns (address) {
        return address(ASSET);
    }
}
