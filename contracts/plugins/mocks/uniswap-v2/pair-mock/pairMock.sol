// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../mock-uni-v2/interfaces/IUniswapV2MockRouter02.sol";
import "../mock-uni-v2/interfaces/IUniswapV2MockFactory.sol";


contract PairMock {
    address immutable tokenA;
    address immutable tokenB;
    address immutable router;
    address immutable factory;
    address immutable pair;

    event LiquityInPool(uint liquidity, uint amountA, uint amountB);
    
    /// Construct a PoolMock for tokenA and tokenB.
    /// User should have already given the router 
    /// an allowance of at least amountADesired/amountBDesired 
    /// on tokenA/tokenB.
    /// @param tokenA_ tokenA address
    /// @param tokenB_ tokenB address
    /// @param router_ route address dereives factory from this 
    /// @param amountADesired amount A desired
    /// @param amountBDesired amount b desired
    /// @param amountAMin mininal amount A
    /// @param amountBMin minial amount B
    /// @param to Recipient of the liquidity tokens.
    /// @param deadline Unix timestamp after which the transaction will revert. 
    constructor(
        address tokenA_,
        address tokenB_,
        address router_,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) {
        tokenA = tokenA_;
        tokenB = tokenB_;
        router = router_;
        factory = IUniswapV2MockRouter02(router).factory();
        pair = IUniswapV2MockFactory(factory).createPair(tokenA_, tokenB_);
        (uint amountA, uint amountB, uint liquidity) = IUniswapV2MockRouter02(router).addLiquidity(
            tokenA_,
            tokenB_,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            to,
            deadline
        );
        emit LiquityInPool(liquidity, amountA, amountB);
    }

    /// @dev utility function adding liquidity to tokenA/tokenB pool
    function addLiquidity(
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) internal returns (uint, uint, uint) {
        return
            IUniswapV2MockRouter02(router).addLiquidity(
                tokenA,
                tokenB,
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin,
                to,
                deadline
            );
    }

    /// @dev utility function removing liquidity to tokenA/tokenB pool
    function removeLiquidity(
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint, uint) {
        return IUniswapV2MockRouter02(router).removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            to,
            deadline
        );
    }
}
