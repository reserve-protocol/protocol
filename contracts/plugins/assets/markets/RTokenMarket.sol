// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/interfaces/IFacadeRead.sol";
import "contracts/interfaces/IMarket.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IWETH.sol";
import "contracts/libraries/Fixed.sol";

import "./AbstractMarket.sol";

contract RTokenMarket is AbstractMulticall {
    using Address for address;
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    constructor() AbstractMulticall() {
        approvedTargets[0xDef1C0ded9bec7F1a1670819833240f027b25EfF] = true; // 0x
    }

    function enter(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        MarketCall[] calldata marketCalls,
        address receiver
    ) external payable returns (uint256 amountOut) {
        require(amountIn != 0, "RTokenMarket: INSUFFICIENT_INPUT");
        require(receiver != address(0), "RTokenMarket: INVALID_RECEIVER");

        if (address(fromToken) != address(0)) {
            fromToken.safeTransferFrom(_msgSender(), address(this), amountIn);
        }

        IRToken rToken = IRToken(address(toToken));

        for (uint256 i = 0; i < marketCalls.length; ++i) {
            MarketCall memory call = marketCalls[i];
            require(approvedTargets[call.target], "RTokenMarket: SWAP_TARGET_NOT_APPROVED");
            call.target.functionDelegateCall(
                abi.encodeWithSelector(IMarket.enter.selector, call),
                "RTokenMarket: DELEGATE_CALL_FAILED"
            );
        }

        address[] memory collateralTokens;
        uint256[] memory collateralAmounts;
        (amountOut, collateralTokens, collateralAmounts) = maxIssuable(rToken, address(this));
        require(amountOut >= minAmountOut, "RTokenMarket: INSUFFICIENT_OUTPUT");

        for (uint256 i = 0; i < collateralTokens.length; ++i) {
            IERC20(collateralTokens[i]).approve(address(rToken), collateralAmounts[i]);
        }

        return rToken.issue(receiver, amountOut);
    }

    function exit(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        MarketCall[] calldata marketCalls,
        address receiver
    ) public payable returns (uint256 amountOut) {
        require(amountIn != 0, "RTokenMarket: INSUFFICIENT_INPUT");
        require(receiver != address(0), "RTokenMarket: INVALID_RECEIVER");

        bool isToETH = address(toToken) == address(0);
        uint256 initialBalance = isToETH ? address(this).balance : toToken.balanceOf(address(this));

        fromToken.safeTransferFrom(_msgSender(), address(this), amountIn);
        IRToken(address(fromToken)).redeem(amountIn);

        for (uint256 i = 0; i < marketCalls.length; ++i) {
            MarketCall memory call = marketCalls[i];
            require(approvedTargets[call.target], "RTokenMarket: SWAP_TARGET_NOT_APPROVED");
            call.target.functionDelegateCall(
                abi.encodeWithSelector(IMarket.exit.selector, call),
                "RTokenMarket: DELEGATE_CALL_FAILED"
            );
        }

        amountOut =
            (isToETH ? address(this).balance : toToken.balanceOf(address(this))) -
            initialBalance;

        require(amountOut >= minAmountOut, "RTokenMarket: INSUFFICIENT_OUTPUT");

        if (isToETH) {
            payable(receiver).transfer(amountOut);
        } else {
            toToken.safeTransfer(receiver, amountOut);
        }
    }

    function maxIssuable(IRToken rToken, address account)
        public
        returns (
            uint256 rTokenAmount,
            address[] memory collateralTokens,
            uint256[] memory collateralAmounts
        )
    {
        IMain main = rToken.main();
        IBasketHandler basketHandler = main.basketHandler();

        main.poke();

        // Cache total supply and decimals
        uint256 totalSupply = rToken.totalSupply();
        int8 decimals = int8(rToken.decimals());

        // {BU}
        uint192 held = basketHandler.basketsHeldBy(account);
        uint192 needed = rToken.basketsNeeded();

        rTokenAmount = (
            needed.eq(FIX_ZERO) // {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
                ? held // {qRTok} = {BU} * {rTok} / {BU} * {qRTok/rTok}
                : held.mulDiv(shiftl_toFix(totalSupply, -decimals), needed)
        ).shiftl_toUint(decimals);

        // Compute # of baskets to create `rTokenAmount` qRTok
        uint192 baskets = (totalSupply > 0) // {BU}
            ? needed.muluDivu(rTokenAmount, totalSupply) // {BU * qRTok / qRTok}
            : shiftl_toFix(rTokenAmount, -decimals); // {qRTok / qRTok}

        (collateralTokens, collateralAmounts) = basketHandler.quote(baskets, CEIL);
    }
}
