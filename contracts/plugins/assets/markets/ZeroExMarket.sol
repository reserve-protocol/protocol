// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IWETH.sol";
import "./PermissionedMarket.sol";

contract ZeroExMarket is PermissionedMarket {
    using SafeERC20 for IERC20;
    IWETH public constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    constructor() PermissionedMarket() {
        approvedTargets[0xDef1C0ded9bec7F1a1670819833240f027b25EfF] = true;
    }

    function enter(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable virtual override returns (uint256 outTokenAmount) {
        outTokenAmount = _swap(
            fromToken,
            amountIn,
            toToken,
            minAmountOut,
            swapTarget,
            swapCallData,
            receiver
        );

        toToken.safeTransfer(receiver, outTokenAmount);
    }

    function exit(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable virtual override returns (uint256 outTokenAmount) {
        outTokenAmount = _swap(
            fromToken,
            amountIn,
            toToken,
            minAmountOut,
            swapTarget,
            swapCallData,
            receiver
        );

        toToken.safeTransfer(receiver, outTokenAmount);
    }

    function _swap(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) internal returns (uint256 outTokenAmount) {
        require(approvedTargets[swapTarget], "ZeroExMarket: SWAP_TARGET_NOT_APPROVED");

        // Base Case: X => X
        if (address(fromToken) == address(toToken)) {
            require(amountIn >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
            return amountIn;
        }

        require(amountIn != 0, "ZeroExMarket: INSUFFICIENT_INPUT");
        if (address(fromToken) == address(0)) {
            require(msg.value == amountIn, "ZeroExMarket: INVALID_INPUT");

            // ETH => WETH
            if (address(toToken) == address(WETH)) {
                require(amountIn >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");
                WETH.deposit{ value: msg.value }();
                WETH.transfer(receiver, msg.value);

                return msg.value;
            }
        } else {
            require(msg.value == 0, "ZeroExMarket: INVALID_INPUT");
            fromToken.safeTransferFrom(msg.sender, address(this), amountIn);
        }

        // WETH => ETH
        if (address(fromToken) == address(WETH) && address(toToken) == address(0)) {
            WETH.withdraw(amountIn);
            payable(receiver).transfer(amountIn);

            require(amountIn >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
            return amountIn;
        }

        // X => Y
        uint256 balanceBefore = address(toToken) == address(0)
            ? address(this).balance
            : toToken.balanceOf(address(this));

        if (address(fromToken) != address(0)) {
            fromToken.approve(swapTarget, amountIn);
        }
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = swapTarget.call{ value: amountIn }(swapCallData);
        require(success, "ZeroExMarket: SWAP_TARGET_CALL_FAILED");

        uint256 balanceAfter = address(toToken) == address(0)
            ? address(this).balance
            : toToken.balanceOf(address(this));

        outTokenAmount = balanceAfter - balanceBefore;
        require(outTokenAmount >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");
    }
}
