// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import {IUniswapV3Wrapper} from "./IUniswapV3Wrapper.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol"; //TODO remove console.log

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-periphery/contracts/libraries/PositionValue.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3Wrapper is ERC20, IUniswapV3Wrapper, ReentrancyGuard {
    uint256 private constant PRECISION_RATIO = 1e21;
    struct Deposit {
        uint256 tokenId;
        address token0;
        address token1;
    }

    bool isInitialized = false;
    Deposit deposit;

    INonfungiblePositionManager immutable nonfungiblePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    IUniswapV3Factory immutable uniswapV3Factory = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);
    IUniswapV3Pool pool;

    //rewards distribution
    uint256 internal _lifetimeRewards0;
    uint256 internal _lifetimeRewards1;
    uint256 internal _lifetimeRewardsClaimed0;
    uint256 internal _lifetimeRewardsClaimed1;
    uint256 internal _accRewardsPerToken0;
    uint256 internal _accRewardsPerToken1;

    mapping(address => uint256) internal _userSnapshotRewardsPerToken0;
    mapping(address => uint256) internal _userSnapshotRewardsPerToken1;
    mapping(address => uint256) internal _unclaimedRewards0;
    mapping(address => uint256) internal _unclaimedRewards1;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(INonfungiblePositionManager.MintParams memory params)
        external
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(!isInitialized, "Contract is already initialized here!");
        isInitialized = true;
        pool = IUniswapV3Pool(uniswapV3Factory.getPool(params.token0, params.token1, params.fee));

        params.recipient = address(this);
        params.deadline = block.timestamp;

        TransferHelper.safeTransferFrom(params.token0, msg.sender, address(this), params.amount0Desired);
        TransferHelper.safeTransferFrom(params.token1, msg.sender, address(this), params.amount1Desired);

        TransferHelper.safeApprove(params.token0, address(nonfungiblePositionManager), params.amount0Desired);
        TransferHelper.safeApprove(params.token1, address(nonfungiblePositionManager), params.amount1Desired);

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager.mint(params);
        _mint(msg.sender, liquidity);

        if (amount0 < params.amount0Desired) {
            TransferHelper.safeApprove(params.token0, address(nonfungiblePositionManager), 0);
            uint256 refund0 = params.amount0Desired - amount0;
            TransferHelper.safeTransfer(params.token0, msg.sender, refund0);
        }

        if (amount1 < params.amount1Desired) {
            TransferHelper.safeApprove(params.token1, address(nonfungiblePositionManager), 0);
            uint256 refund1 = params.amount1Desired - amount1;
            TransferHelper.safeTransfer(params.token1, msg.sender, refund1);
        }

        deposit.token0 = params.token0;
        deposit.token1 = params.token1;
        deposit.tokenId = tokenId;
    }

    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        nonReentrant
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(isInitialized, "Contract is not initialized!");
        _updateRewards();

        TransferHelper.safeTransferFrom(deposit.token0, msg.sender, address(this), amount0Desired);
        TransferHelper.safeTransferFrom(deposit.token1, msg.sender, address(this), amount1Desired);

        TransferHelper.safeApprove(deposit.token0, address(nonfungiblePositionManager), amount0Desired);
        TransferHelper.safeApprove(deposit.token1, address(nonfungiblePositionManager), amount1Desired);

        INonfungiblePositionManager.IncreaseLiquidityParams memory increaseLiquidityParams;
        increaseLiquidityParams.tokenId = deposit.tokenId;
        increaseLiquidityParams.amount0Desired = amount0Desired;
        increaseLiquidityParams.amount1Desired = amount1Desired;
        increaseLiquidityParams.amount0Min = 0;
        increaseLiquidityParams.amount1Min = 0;
        increaseLiquidityParams.deadline = block.timestamp;
        (liquidity, amount0, amount1) = nonfungiblePositionManager.increaseLiquidity(increaseLiquidityParams);
        _mint(msg.sender, liquidity);
    }

    function decreaseLiquidity(uint128 liquidity) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(isInitialized, "Contract is not initialized!");
        _updateRewards();

        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseLiquidityParams;
        decreaseLiquidityParams.tokenId = deposit.tokenId;
        decreaseLiquidityParams.liquidity = liquidity;
        decreaseLiquidityParams.amount0Min = 0;
        decreaseLiquidityParams.amount1Min = 0;
        decreaseLiquidityParams.deadline = block.timestamp;
        (amount0, amount1) = nonfungiblePositionManager.decreaseLiquidity(decreaseLiquidityParams);

        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager.CollectParams(
            deposit.tokenId,
            msg.sender,
            uint128(amount0),
            uint128(amount1)
        );
        nonfungiblePositionManager.collect(collectParams);
        _burn(msg.sender, liquidity);
    }

    function claimRewards(address recipient)
        external
        nonReentrant
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(isInitialized, "Contract is not initialized!");
        _updateRewards();
        _updateUser(msg.sender);
        if (
            _unclaimedRewards0[msg.sender] > IERC20(deposit.token0).balanceOf(address(this)) ||
            _unclaimedRewards1[msg.sender] > IERC20(deposit.token1).balanceOf(address(this))
        ) {
            _claimFees();
        }
        TransferHelper.safeTransfer(deposit.token0, recipient, _unclaimedRewards0[msg.sender]);
        TransferHelper.safeTransfer(deposit.token1, recipient, _unclaimedRewards1[msg.sender]);
        _unclaimedRewards0[msg.sender] = 0;
        _unclaimedRewards1[msg.sender] = 0;
        return (deposit.token0, deposit.token1, _unclaimedRewards0[msg.sender], _unclaimedRewards1[msg.sender]);
    }

    function positionId() external view returns (uint256) {
        return deposit.tokenId;
    }

    function principal() external view returns (uint256 amount0, uint256 amount1) {
        require(isInitialized, "Contract is not initialized!");
        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
        (amount0, amount1) = PositionValue.principal(nonfungiblePositionManager, deposit.tokenId, sqrtRatioX96);
    }

    /**
     * @notice Updates rewards both sender and receiver of each transfer
     * @param from The address of the sender of tokens
     * @param to The address of the receiver of tokens
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal override {
        _updateRewards();
        if (from != address(0)) {
            _updateUser(from);
        }
        if (to != address(0)) {
            _updateUser(to);
        }
    }

    function divUnchecked(uint256 a, uint256 b) internal pure returns (uint256) {
        unchecked {
            return a / b;
        }
    }

    function _updateRewards() internal {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return;
        }
        (uint256 freshRewards0, uint256 freshRewards1) = _fees();
        uint256 lifetimeRewards0 = _lifetimeRewardsClaimed0 + freshRewards0;
        uint256 lifetimeRewards1 = _lifetimeRewardsClaimed1 + freshRewards1;

        uint256 rewardsAccrued0 = lifetimeRewards0 - _lifetimeRewards0;
        uint256 rewardsAccrued1 = lifetimeRewards1 - _lifetimeRewards1;

        _accRewardsPerToken0 = _accRewardsPerToken0 + divUnchecked(rewardsAccrued0 * PRECISION_RATIO, supply);
        _accRewardsPerToken1 = _accRewardsPerToken1 + divUnchecked(rewardsAccrued1 * PRECISION_RATIO, supply);
        _lifetimeRewards0 = lifetimeRewards0;
        _lifetimeRewards1 = lifetimeRewards1;
    }

    /**
     * @notice Updates rewards both a single user
     * @param user The address of the sender or receiver of tokens
     */
    function _updateUser(address user) internal {
        uint256 balance = balanceOf(user);
        console.log("user", user);
        console.log("balance", balance);
        console.log("totalSupply", totalSupply());

        (uint256 pending0, uint256 pending1) = _getPendingRewards(user, balance);
        console.log("pending0", pending0);
        console.log("pending1", pending1);
        _unclaimedRewards0[user] += pending0;
        _unclaimedRewards1[user] += pending1;
        _updateUserSnapshotRewardsPerToken(user);
    }

    /**
     * @notice Compute pending rewards for a user.
     * @param user The user to compute pending rewards for
     * @param balance The balance of the user
     * @return pending0 The amount of pending rewards for token0
     * @return pending1 The amount of pending rewards for token1
     */
    function _getPendingRewards(address user, uint256 balance)
        internal
        view
        returns (uint256 pending0, uint256 pending1)
    {
        pending0 = (balance * (_accRewardsPerToken0 - _userSnapshotRewardsPerToken0[user])) / PRECISION_RATIO;
        pending1 = (balance * (_accRewardsPerToken1 - _userSnapshotRewardsPerToken1[user])) / PRECISION_RATIO;
    }

    /**
     * @notice Update the user's snapshot of rewards per token
     * @param user The user to update
     */
    function _updateUserSnapshotRewardsPerToken(address user) internal {
        _userSnapshotRewardsPerToken0[user] = _accRewardsPerToken0;
        _userSnapshotRewardsPerToken1[user] = _accRewardsPerToken1;
    }

    function _fees() internal view virtual returns (uint256 feesAmount0, uint256 feesAmount1) {
        (feesAmount0, feesAmount1) = PositionValue.fees(nonfungiblePositionManager, deposit.tokenId);
    }

    function _claimFees() internal {
        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager.CollectParams(
            deposit.tokenId,
            address(this),
            type(uint128).max,
            type(uint128).max
        );
        (uint256 amount0, uint256 amount1) = nonfungiblePositionManager.collect(collectParams);
        _lifetimeRewardsClaimed0 += amount0;
        _lifetimeRewardsClaimed1 += amount1;
        _lifetimeRewards0 += amount0;
        _lifetimeRewards1 += amount1;
    }
}
