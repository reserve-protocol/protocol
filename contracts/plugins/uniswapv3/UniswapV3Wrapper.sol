// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import { IUniswapV3Wrapper } from "./IUniswapV3Wrapper.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";

import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

contract UniswapV3Wrapper is ERC20, IUniswapV3Wrapper, ReentrancyGuard {
    struct Deposit {
        uint256 tokenId;
        uint128 liquidity;
        //todo need we owner or msg.sender is enough
        address owner;
        address token0;
        address token1;
    }


    bool isInitialized = false;
    Deposit deposit;

    INonfungiblePositionManager immutable nonfungiblePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

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
        require(!isInitialized, 'Contract is already initialized!');
        isInitialized = true;

        params.recipient = address(this);
        params.deadline = block.timestamp;

        TransferHelper.safeTransferFrom(
            params.token0,
            msg.sender,
            address(this),
            params.amount0Desired
        );
        TransferHelper.safeTransferFrom(
            params.token1,
            msg.sender,
            address(this),
            params.amount1Desired
        );

        TransferHelper.safeApprove(
            params.token0,
            address(nonfungiblePositionManager),
            params.amount0Desired
        );
        TransferHelper.safeApprove(
            params.token1,
            address(nonfungiblePositionManager),
            params.amount1Desired
        );

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager.mint(params);
        _mint(msg.sender, liquidity);

        if (amount0 < params.amount0Desired) {
            TransferHelper.safeApprove(params.token0, address(nonfungiblePositionManager), 0); //TODO why approve 0 to other direction?
            uint256 refund0 = params.amount0Desired - amount0;
            TransferHelper.safeTransfer(params.token0, msg.sender, refund0);
        }

        if (amount1 < params.amount1Desired) {
            TransferHelper.safeApprove(params.token1, address(nonfungiblePositionManager), 0);
            uint256 refund1 = params.amount1Desired - amount1;
            TransferHelper.safeTransfer(params.token1, msg.sender, refund1);
        }

        deposit.liquidity = liquidity;
        deposit.token0 = params.token0;
        deposit.token1 = params.token1;
        deposit.owner = msg.sender;
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
        require(isInitialized, 'Contract is not initialized!');
    
        INonfungiblePositionManager.IncreaseLiquidityParams memory increaseLiquidityParams;
        increaseLiquidityParams.tokenId = deposit.tokenId;
        increaseLiquidityParams.amount0Desired = amount0Desired;
        increaseLiquidityParams.amount1Desired = amount1Desired;
        increaseLiquidityParams.amount0Min = 0;
        increaseLiquidityParams.amount1Min = 0;
        increaseLiquidityParams.deadline = block.timestamp;
        (liquidity, amount0, amount1) = nonfungiblePositionManager.increaseLiquidity(
            increaseLiquidityParams
        );
        deposit.liquidity = liquidity;
        _mint(msg.sender, liquidity);
    }

    function decreaseLiquidity(uint128 liquidity)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        require(isInitialized, 'Contract is not initialized!');

        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseLiquidityParams;
        decreaseLiquidityParams.tokenId = deposit.tokenId;
        decreaseLiquidityParams.amount0Min = 0;
        decreaseLiquidityParams.amount1Min = 0;
        decreaseLiquidityParams.deadline = block.timestamp;
        (amount0, amount1) = nonfungiblePositionManager.decreaseLiquidity(decreaseLiquidityParams);
        deposit.liquidity -= liquidity;
        _burn(msg.sender, liquidity);

        //TODO
        _sendToOwner(amount0, amount1);
    }

    /// @notice Transfers funds to owner of NFT
    /// @param amount0 The amount of token0
    /// @param amount1 The amount of token1
    function _sendToOwner(uint256 amount0, uint256 amount1) internal {
        TransferHelper.safeTransfer(deposit.token0, deposit.owner, amount0);
        TransferHelper.safeTransfer(deposit.token1, deposit.owner, amount1);
    }

    function positions() external view returns (uint128 tokensOwed0, uint128 tokensOwed1) {
        require(isInitialized, 'Contract is not initialized!');

        (, , , , , , , , , , tokensOwed0, tokensOwed1) = nonfungiblePositionManager.positions(
            deposit.tokenId
        );
    }

    function collect(uint128 amount0Max, uint128 amount1Max)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        require(isInitialized, 'Contract is not initialized!');

        INonfungiblePositionManager.CollectParams memory collectParams;
        collectParams.tokenId = deposit.tokenId;
        collectParams.recipient = msg.sender;
        collectParams.amount0Max = amount0Max;
        collectParams.amount1Max = amount1Max;
        (amount0, amount1) = nonfungiblePositionManager.collect(collectParams);

        //TODO
        _sendToOwner(amount0, amount1);
    }

    function positionId() external view returns (uint256) {
        return deposit.tokenId;
    }
}
