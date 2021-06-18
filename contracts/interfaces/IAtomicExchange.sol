// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;


/// Uniswap, 1inch, and any exchange provider could be an IAtomicExchange
interface IAtomicExchange {

    function trade(
        address sellingToken, 
        address buyingToken, 
        uint256 sellingAmount
    ) external;

    function trade(
        address sellingToken, 
        address buyingToken, 
        uint256 sellingAmount,
        uint256 minBuyingAmountWouldAccept
    ) external;
}
