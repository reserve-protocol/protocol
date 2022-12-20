// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IWETH.sol";
import "contracts/interfaces/IMarket.sol";

contract ZeroExMarket is IMarket {
    address public constant ZERO_EX = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;
    IWETH public constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    function enter(MarketCall calldata call) external override {
        _swap(
            call.fromToken,
            call.amountIn,
            call.toToken,
            call.minAmountOut,
            call.value,
            call.data
        );
    }

    function exit(MarketCall calldata call) external override {
        _swap(
            call.fromToken,
            call.amountIn,
            call.toToken,
            call.minAmountOut,
            call.value,
            call.data
        );
    }

    function _swap(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        uint256 value,
        bytes calldata data
    ) internal {
        // A => A
        if (address(fromToken) == address(toToken)) {
            if (amountIn < minAmountOut) revert InsufficientInput();
        }
        // ETH => WETH
        else if (address(fromToken) == address(0) && address(toToken) == address(WETH)) {
            if (amountIn < minAmountOut) revert InsufficientInput();
            WETH.deposit{ value: amountIn }();
        }
        // WETH => ETH
        else if (address(fromToken) == address(WETH) && address(toToken) == address(0)) {
            if (amountIn < minAmountOut) revert InsufficientInput();
            WETH.withdraw(amountIn);
        }
        // A => B
        else {
            if (address(fromToken) != address(0)) {
                fromToken.approve(ZERO_EX, amountIn);
                value = 0;
            }

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returndata) = ZERO_EX.call{ value: value }(data);
            if (!success) revert TargetCallFailed(ZERO_EX, returndata);
        }
    }
}
