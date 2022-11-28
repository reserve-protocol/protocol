// SPDX-License-Identifier: MIT
//solhint-disable-next-line compiler-version
pragma solidity >=0.5.0;

interface IUniswapV2MockCallee {
    function UniswapV2MockCall(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
}
