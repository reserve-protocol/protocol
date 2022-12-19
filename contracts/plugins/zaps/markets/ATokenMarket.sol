// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./AbstractMarket.sol";

contract ATokenMarket is AbstractMarket {
    function enter(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        if (call.amountIn == 0) revert InsufficientInput();

        amountOut = IStaticATokenLM(address(call.toToken)).deposit(
            address(this),
            call.amountIn,
            0,
            true
        );

        if (amountOut < call.minAmountOut) revert InsufficientOutput();
    }

    function exit(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        if (msg.value != 0) revert InvalidValue();
        if (call.amountIn == 0) revert InsufficientInput();

        (, amountOut) = IStaticATokenLM(address(call.fromToken)).withdraw(
            address(this),
            call.amountIn,
            true
        );

        if (amountOut < call.minAmountOut) revert InsufficientOutput();
    }
}

interface IStaticATokenLM is IERC20 {
    function deposit(
        address recipient,
        uint256 amount,
        uint16 referralCode,
        bool fromUnderlying
    ) external returns (uint256 staticAmountMinted);

    function withdraw(
        address recipient,
        uint256 amount,
        bool toUnderlying
    ) external returns (uint256 staticAmountBurned, uint256 underlyingWithdrawn);
}
