// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IWETH.sol";
import "./AbstractMarket.sol";

contract ZeroExMarket is AbstractMarket {
    using SafeERC20 for IERC20;
    IWETH public constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    function enter(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        amountOut = _swap(
            call.fromToken,
            call.amountIn,
            call.toToken,
            call.minAmountOut,
            call.target,
            call.value,
            call.data
        );
    }

    function exit(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        amountOut = _swap(
            call.fromToken,
            call.amountIn,
            call.toToken,
            call.minAmountOut,
            call.target,
            call.value,
            call.data
        );
    }

    function _swap(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address target,
        uint256 value,
        bytes calldata data
    ) internal returns (uint256 amountOut) {
        require(amountIn != 0, "ZeroExMarket: INSUFFICIENT_INPUT");
        require(approvedTargets[target], "ZeroExMarket: SWAP_TARGET_NOT_APPROVED");

        // A => A
        if (address(fromToken) == address(toToken)) {
            require(amountIn >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");
            return amountIn;
        }

        // ETH => WETH
        if (address(fromToken) == address(0) && address(toToken) == address(WETH)) {
            require(amountIn >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");
            WETH.deposit{ value: amountIn }();
            return amountIn;
        }

        // WETH => ETH
        if (address(fromToken) == address(WETH) && address(toToken) == address(0)) {
            require(amountIn >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");
            WETH.withdraw(amountIn);
            return amountIn;
        }

        // A => B
        if (address(fromToken) != address(0)) {
            fromToken.approve(target, amountIn);
            value = 0;
        }

        uint256 initialBalance = _getBalance(toToken);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = target.call{ value: value }(data);
        require(success, "ZeroExMarket: SWAP_TARGET_CALL_FAILED");

        amountOut = _getBalance(toToken) - initialBalance;

        require(amountOut >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");
    }
}
