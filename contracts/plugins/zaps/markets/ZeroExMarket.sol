// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./AbstractMarket.sol";

error ZeroExSwapFailed(bytes returndata);

contract ZeroExMarket is AbstractMarket {
    address public constant ZERO_EX = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;

    function enter(MarketCall calldata call) external payable override {
        _swap(call.fromToken, call.amountIn, call.toToken, call.value, call.data);
    }

    function exit(MarketCall calldata call) external payable override {
        _swap(call.fromToken, call.amountIn, call.toToken, call.value, call.data);
    }

    function _swap(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 value,
        bytes calldata data
    ) internal {
        // A => A
        if (address(fromToken) == address(toToken)) return;

        // ETH => WETH
        if (address(fromToken) == ETH && address(toToken) == address(WETH)) {
            WETH.deposit{ value: value }();
            return;
        }

        // WETH => ETH
        if (address(fromToken) == address(WETH) && address(toToken) == ETH) {
            WETH.withdraw(amountIn);
            return;
        }

        // A => B
        if (address(fromToken) != ETH) {
            fromToken.approve(ZERO_EX, amountIn);
        }

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = ZERO_EX.call{ value: value }(data);
        if (!success) revert ZeroExSwapFailed(returndata);
    }
}
