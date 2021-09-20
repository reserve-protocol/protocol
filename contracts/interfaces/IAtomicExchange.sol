// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

/// Uniswap, 1inch, and any exchange provider could be an IAtomicExchange
interface IAtomicExchange {
    function tradeFixedSell(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) external;

    // function tradeFixedBuy(
    //     address sellToken,
    //     address buyToken,
    //     uint256 buyAmount,
    //     uint256 maxSellAmount
    // ) external;
}
