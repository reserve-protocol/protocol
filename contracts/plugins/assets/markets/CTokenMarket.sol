// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./BaseMarket.sol";

contract CTokenMarket is BaseMarket {
    using SafeERC20 for IERC20;

    IERC20 public constant CETH = IERC20(0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5);

    constructor() {
        // 0x
        approvedTargets[0xDef1C0ded9bec7F1a1670819833240f027b25EfF] = true;
    }

    function enter(
        address fromToken,
        uint256 amountIn,
        address toCToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable override whenNotPaused returns (uint256 outTokenAmount) {
        IERC20 cTokenERC20 = IERC20(toCToken);
        uint256 cTokenInitialBalance = cTokenERC20.balanceOf(address(this));

        // ETH => cETH
        if (fromToken == address(0) && toCToken == address(CETH)) {
            require(msg.value > 0, "CTokenMarket: INSUFFICIENT_INPUT");

            ICompoundToken(toCToken).mint{ value: msg.value }();
            outTokenAmount = cTokenERC20.balanceOf(address(this)) - cTokenInitialBalance;

            require(outTokenAmount >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
            return outTokenAmount;
        }

        require(amountIn > 0, "CTokenMarket: INSUFFICIENT_INPUT");
        if (fromToken == address(0)) {
            require(msg.value == amountIn, "CTokenMarket: INVALID_INPUT");
        } else {
            require(msg.value == 0, "CTokenMarket: NONZERO_MESSAGE_VALUE");
            IERC20(fromToken).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(fromToken).safeApprove(swapTarget, amountIn);
        }

        // Swaps
        require(approvedTargets[swapTarget], "CTokenMarket: SWAP_TARGET_NOT_APPROVED");

        // X => ETH => cETH
        if (toCToken == address(CETH)) {
            uint256 initialUnderlyingAmount = address(this).balance;
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = swapTarget.call{ value: msg.value }(swapCallData);
            require(success, "CTokenMarket: SWAP_TARGET_CALL_FAILED");

            uint256 underlyingAmount = address(this).balance - initialUnderlyingAmount;
            ICompoundToken(toCToken).mint{ value: underlyingAmount }();
        }
        // X => Underlying => CompoundToken
        else {
            IERC20 underlyingERC20 = IERC20(ICompoundToken(toCToken).underlying());
            uint256 initialUnderlyingAmount = underlyingERC20.balanceOf(address(this));

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = swapTarget.call{ value: msg.value }(swapCallData);
            require(success, "CTokenMarket: SWAP_TARGET_CALL_FAILED");

            uint256 underlyingAmount = underlyingERC20.balanceOf(address(this)) -
                initialUnderlyingAmount;
            underlyingERC20.safeApprove(toCToken, underlyingAmount);
            ICompoundToken(toCToken).mint(underlyingAmount);
        }

        outTokenAmount = cTokenERC20.balanceOf(address(this)) - cTokenInitialBalance;
        require(outTokenAmount >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");

        cTokenERC20.safeTransfer(receiver, outTokenAmount);
    }

    function exit(
        address fromCToken,
        uint256 amountIn,
        address toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable override whenNotPaused returns (uint256 outTokenAmount) {
        require(msg.value == 0, "CTokenMarket: INVALID_VALUE");
        require(amountIn > 0, "CTokenMarket: INSUFFICIENT_INPUT");
        IERC20(fromCToken).safeTransferFrom(msg.sender, address(this), amountIn);

        // cETH => ETH
        if (fromCToken == address(CETH) && toToken == address(0)) {
            uint256 balanceBefore = address(this).balance;

            ICompoundToken(fromCToken).redeem(amountIn);
            outTokenAmount = address(this).balance - balanceBefore;

            payable(receiver).transfer(outTokenAmount);

            require(outTokenAmount >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
            return outTokenAmount;
        }

        // CompoundToken => Underlying
        IERC20 underlyingERC20 = IERC20(ICompoundToken(fromCToken).underlying());
        uint256 underlyingTokenInitialBalance = underlyingERC20.balanceOf(address(this));

        ICompoundToken(fromCToken).redeem(amountIn);
        uint256 underlyingTokenAmount = underlyingERC20.balanceOf(address(this)) -
            underlyingTokenInitialBalance;

        // Underlying => To
        if (toToken == address(underlyingERC20)) {
            outTokenAmount = underlyingTokenAmount;
        } else {
            uint256 toTokenInitialBalance = IERC20(toToken).balanceOf(address(this));

            require(approvedTargets[swapTarget], "CTokenMarket: SWAP_TARGET_NOT_APPROVED");
            underlyingERC20.safeApprove(swapTarget, underlyingTokenAmount);
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = swapTarget.call(swapCallData);
            require(success, "CTokenMarket: SWAP_TARGET_CALL_FAILED");

            outTokenAmount = IERC20(toToken).balanceOf(address(this)) - toTokenInitialBalance;
        }

        require(outTokenAmount >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
        IERC20(toToken).safeTransfer(receiver, outTokenAmount);
    }

    receive() external payable {
        // solhint-disable-next-line avoid-tx-origin
        require(msg.sender != tx.origin, "Do not send ETH directly");
    }
}

interface ICompoundToken {
    function underlying() external view returns (address);

    function mint(uint256 mintAmount) external returns (uint256);

    function mint() external payable;

    function redeem(uint256 redeemTokens) external returns (uint256);

    function exchangeRateStored() external view returns (uint256);
}
