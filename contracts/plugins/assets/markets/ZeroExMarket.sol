// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./BaseMarket.sol";

contract ZeroExMarket is BaseMarket {
    using SafeERC20 for IERC20;

    constructor() {
        // 0x
        approvedTargets[0xDef1C0ded9bec7F1a1670819833240f027b25EfF] = true;
    }

    function enter(
        address fromToken,
        uint256 amountIn,
        address toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable override returns (uint256 outTokenAmount) {
        outTokenAmount = _swap(
            fromToken,
            amountIn,
            toToken,
            minAmountOut,
            swapTarget,
            swapCallData,
            receiver
        );
    }

    function exit(
        address fromToken,
        uint256 amountIn,
        address toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable override returns (uint256 outTokenAmount) {
        outTokenAmount = _swap(
            fromToken,
            amountIn,
            toToken,
            minAmountOut,
            swapTarget,
            swapCallData,
            receiver
        );
    }

    function _swap(
        address fromToken,
        uint256 amountIn,
        address toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) internal whenNotPaused returns (uint256 outTokenAmount) {
        require(approvedTargets[swapTarget], "ZeroExMarket: SWAP_TARGET_NOT_APPROVED");

        // Base Case: X => X
        if (fromToken == toToken) {
            require(amountIn >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");

            return amountIn;
        }

        // ETH => WETH
        if (fromToken == address(0) && toToken == address(WETH)) {
            require(msg.value > 0 && msg.value >= minAmountOut, "ZeroExMarket: INSUFFICIENT_INPUT");

            WETH.deposit{ value: msg.value }();
            IERC20(toToken).safeTransfer(receiver, outTokenAmount);

            return msg.value;
        }

        require(amountIn > 0, "ZeroExMarket: INSUFFICIENT_INPUT");
        if (fromToken == address(0)) {
            require(msg.value == amountIn, "ZeroExMarket: INVALID_INPUT");
        } else {
            require(msg.value == 0, "ZeroExMarket: NONZERO_MESSAGE_VALUE");
            IERC20(fromToken).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        // WETH => ETH
        if (fromToken == address(WETH) && toToken == address(0)) {
            WETH.withdraw(amountIn);
            payable(receiver).transfer(amountIn);

            require(amountIn >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
            return amountIn;
        }

        // X => Y
        uint256 balanceBefore = toToken == address(0)
            ? address(this).balance
            : IERC20(toToken).balanceOf(address(this));

        if (fromToken != address(0)) {
            IERC20(fromToken).safeApprove(swapTarget, amountIn);
        }
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = swapTarget.call{ value: msg.value }(swapCallData);
        require(success, "ZeroExMarket: SWAP_TARGET_CALL_FAILED");

        uint256 balanceAfter = toToken == address(0)
            ? address(this).balance
            : IERC20(toToken).balanceOf(address(this));

        outTokenAmount = balanceAfter - balanceBefore;
        require(outTokenAmount >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");

        IERC20(toToken).safeTransfer(receiver, outTokenAmount);
    }

    receive() external payable {
        // solhint-disable-next-line avoid-tx-origin
        require(msg.sender != tx.origin, "Do not send ETH directly");
    }
}
