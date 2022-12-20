// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "contracts/interfaces/IMarket.sol";

contract ATokenMarket is IMarket {
    function enter(MarketCall calldata call) external override {
        IStaticATokenLM(address(call.toToken)).deposit(address(this), call.amountIn, 0, true);
    }

    function exit(MarketCall calldata call) external override {
        IStaticATokenLM(address(call.fromToken)).withdraw(address(this), call.amountIn, true);
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
