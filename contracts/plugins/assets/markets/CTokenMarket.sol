// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ZeroExMarket.sol";

contract CTokenMarket is ZeroExMarket {
    using SafeERC20 for IERC20;
    IERC20 public constant CETH = IERC20(0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5);

    // solhint-disable-next-line no-empty-blocks
    constructor() ZeroExMarket() {}

    function enter(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toCToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable virtual override returns (uint256 outTokenAmount) {
        require(amountIn != 0, "CTokenMarket: INSUFFICIENT_INPUT");
        require(approvedTargets[swapTarget], "CTokenMarket: SWAP_TARGET_NOT_APPROVED");

        ICompoundToken cToken = ICompoundToken(address(toCToken));
        uint256 cTokenBalanceBefore = toCToken.balanceOf(address(this));

        if (address(fromToken) == address(0)) {
            require(msg.value == amountIn, "CTokenMarket: INVALID_INPUT");

            // ETH => cETH
            if (address(toCToken) == address(CETH)) {
                cToken.mint{ value: amountIn }();
                outTokenAmount = toCToken.balanceOf(address(this)) - cTokenBalanceBefore;

                require(outTokenAmount >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
                return outTokenAmount;
            }
        } else {
            require(msg.value == 0, "CTokenMarket: INVALID_INPUT");

            fromToken.safeTransferFrom(msg.sender, address(this), amountIn);
            fromToken.approve(swapTarget, amountIn);
        }

        // X => ETH => cETH
        if (address(fromToken) != address(0) && address(toCToken) == address(CETH)) {
            uint256 initialBalance = address(this).balance;
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = swapTarget.call{ value: 0 }(swapCallData);
            require(success, "CTokenMarket: SWAP_TARGET_CALL_FAILED");

            cToken.mint{ value: address(this).balance - initialBalance }();
        }
        // Underlying => CompoundToken
        else if (address(fromToken) == cToken.underlying()) {
            IERC20 underlyingToken = IERC20(cToken.underlying());
            underlyingToken.approve(address(toCToken), amountIn);
            cToken.mint(amountIn);
        }
        // X => Underlying => CompoundToken
        else {
            IERC20 underlyingToken = IERC20(cToken.underlying());
            uint256 underlyingBalanceBefore = underlyingToken.balanceOf(address(this));

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = swapTarget.call(swapCallData);
            require(success, "CTokenMarket: SWAP_TARGET_CALL_FAILED");

            uint256 underlyingAmount = underlyingToken.balanceOf(address(this)) -
                underlyingBalanceBefore;

            underlyingToken.approve(address(toCToken), underlyingAmount);
            cToken.mint(underlyingAmount);
        }

        outTokenAmount = toCToken.balanceOf(address(this)) - cTokenBalanceBefore;
        require(outTokenAmount >= minAmountOut, "ZeroExMarket: INSUFFICIENT_OUTPUT");

        toCToken.safeTransfer(receiver, outTokenAmount);
    }

    function exit(
        IERC20 fromCToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable virtual override returns (uint256 outTokenAmount) {
        require(msg.value == 0, "CTokenMarket: INVALID_VALUE");
        require(amountIn != 0, "CTokenMarket: INSUFFICIENT_INPUT");
        fromCToken.safeTransferFrom(msg.sender, address(this), amountIn);

        ICompoundToken cToken = ICompoundToken(address(fromCToken));

        // cETH => ETH
        if (address(fromCToken) == address(CETH) && address(toToken) == address(0)) {
            uint256 initialBalance = address(this).balance;

            cToken.redeem(amountIn);
            outTokenAmount = address(this).balance - initialBalance;

            payable(receiver).transfer(outTokenAmount);

            require(outTokenAmount >= minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
            return outTokenAmount;
        }

        // CompoundToken => Underlying
        IERC20 underlyingToken = IERC20(cToken.underlying());
        uint256 underlyingBalanceBefore = underlyingToken.balanceOf(address(this));

        ICompoundToken(address(fromCToken)).redeem(amountIn);
        uint256 underlyingTokenAmount = underlyingToken.balanceOf(address(this)) -
            underlyingBalanceBefore;

        // Underlying => X
        outTokenAmount = _swap(
            underlyingToken,
            underlyingTokenAmount,
            toToken,
            minAmountOut,
            swapTarget,
            swapCallData,
            address(this)
        );

        toToken.safeTransfer(receiver, outTokenAmount);
    }
}

interface ICompoundToken {
    function underlying() external view returns (address);

    function mint(uint256 mintAmount) external returns (uint256);

    function mint() external payable;

    function redeem(uint256 redeemTokens) external returns (uint256);

    function exchangeRateStored() external view returns (uint256);
}
