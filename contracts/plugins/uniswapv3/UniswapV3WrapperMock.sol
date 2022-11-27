// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import { UniswapV3Wrapper } from "./UniswapV3Wrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3WrapperMock is UniswapV3Wrapper {
    struct Values {
        uint256 feesAmount0;
        uint256 feesAmount1;
        address sender;
    }

    Values values;

    constructor(
        string memory name_,
        string memory symbol_,
        INonfungiblePositionManager.MintParams memory params
    ) UniswapV3Wrapper(name_, symbol_, params) {}

    function positions()
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0, //
            uint128 tokensOwed1
        )
    {
        require(isInitialized, "Contract is not initialized!");
        return nonfungiblePositionManager.positions(_tokenId);
    }

    function updateUser(address user) public {
        _updateUser(user);
    }

    function unclaimedRewards0(address user) public view returns (uint256) {
        return _unclaimedRewards[_rewardsTokens[0]][user];
    }

    function unclaimedRewards1(address user) public view returns (uint256) {
        return _unclaimedRewards[_rewardsTokens[1]][user];
    }

    function setFees(uint256 feesAmount0, uint256 feesAmount1) public {
        values.feesAmount0 = feesAmount0;
        values.feesAmount1 = feesAmount1;
    }

    function setFeesSender(address sender) public {
        values.sender = sender;
    }

    function _collectRewards() internal override returns (uint256 feesAmount0, uint256 feesAmount1) {
        TransferHelper.safeTransferFrom(_rewardsTokens[0], values.sender, address(this), values.feesAmount0);
        TransferHelper.safeTransferFrom(_rewardsTokens[1], values.sender, address(this), values.feesAmount1);
        feesAmount0 = values.feesAmount0;
        feesAmount1 = values.feesAmount1;
        values.feesAmount0 = 0;
        values.feesAmount1 = 0;
    }

    function _freshRewards() internal view override returns (uint256 feesAmount0, uint256 feesAmount1) {
        return (values.feesAmount0, values.feesAmount1);
    }
}
