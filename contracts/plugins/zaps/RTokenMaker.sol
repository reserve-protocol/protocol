// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";

import "./AbstractMaker.sol";

/// @title RTokenMaker
/// @notice A Maker that issues RTokens from a single input token
///         or redeems an RToken into a single output token
/// @dev RTokenMaker provides the implementation, AbstractMaker provides the helper functions
contract RTokenMaker is AbstractMaker {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    /// Perform an instant or time-delayed issuance of RToken from a particular input token
    /// @param fromToken The deposit token
    /// @param amountIn {qTok} The quantity of the deposit token to deposit
    /// @param rToken The RToken to mint
    /// @param minAmountOut {qRTok} The minimum quantity of RToken to mint
    /// @param marketCalls The market calls to execute before minting
    /// @param recipient The recipient of the minted RToken
    /// @return mintedAmount {qToken} The quantity of RTokens instnatly minted in this transaction
    function issue(
        IERC20 fromToken,
        uint256 amountIn,
        IRToken rToken,
        uint256 minAmountOut,
        MarketCall[] calldata marketCalls,
        address recipient
    ) external payable nonDelegateCall nonReentrant returns (uint256 mintedAmount) {
        // Checks
        if (amountIn == 0) revert InsufficientInput();
        if (recipient == address(0)) revert InvalidRecipient();

        // Deposit fromToken
        if (address(fromToken) != address(0)) {
            fromToken.safeTransferFrom(_msgSender(), self, amountIn);
        }

        // Execute market calls
        uint256 callCount = marketCalls.length;
        for (uint256 i = 0; i < callCount; ++i) _marketEnter(marketCalls[i]);

        // Calculate the maximum issuable amount of RToken
        (
            uint256 amountOut,
            address[] memory collateralTokens,
            uint256[] memory collateralAmounts
        ) = _maxIssuable(rToken, self);
        if (amountOut < minAmountOut) revert InsufficientOutput();

        // Approve collateral
        uint256 collateralCount = collateralTokens.length;
        for (uint256 i = 0; i < collateralCount; ++i) {
            IERC20(collateralTokens[i]).approve(address(rToken), collateralAmounts[i]);
        }

        // Issue RTokens, this call returns the amount of RToken instantly minted
        return rToken.issue(recipient, amountOut);
    }

    /// Redeem an RToken and trade it for a particular output token
    /// @param rToken The deposit token
    /// @param amountIn {qTok} The quantity of the RToken to deposit and redeem
    /// @param toToken The token to receive by the end of the transaction
    /// @param minAmountOut {qRTok} The minimum quantity of toToken to receive
    /// @param marketCalls The market calls to execute after redemption
    /// @param recipient The recipient of the output toToken
    /// @return amountOut {qToken} The quantity of toToken received in this transaction
    function redeem(
        IRToken rToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        MarketCall[] calldata marketCalls,
        address recipient
    ) external payable nonDelegateCall nonReentrant returns (uint256 amountOut) {
        // Checks
        if (amountIn == 0) revert InsufficientInput();
        if (recipient == address(0)) revert InvalidRecipient();

        // Store the initial balance
        uint256 initialBalance = _getBalance(toToken);

        // Redeem RToken
        IERC20(address(rToken)).safeTransferFrom(_msgSender(), self, amountIn);
        rToken.redeem(amountIn);

        // Execute market calls
        uint256 callCount = marketCalls.length;
        for (uint256 i = 0; i < callCount; ++i) _marketExit(marketCalls[i]);

        // Calculate amountOut
        amountOut = _getBalance(toToken) - initialBalance;
        if (amountOut < minAmountOut) revert InsufficientOutput();

        // Transfer toToken to recipient
        if (address(toToken) == address(0)) {
            // solhint-disable-next-line no-low-level-calls
            (bool success, ) = recipient.call{ value: amountOut }(""); // inlined Address.sendValue
            if (!success) revert TargetCallFailed(recipient, "ETH_TRANSFER_FAILED");
        } else {
            toToken.safeTransfer(recipient, amountOut);
        }
    }

    /// @notice Inlined from FacadeRead to save gas
    /// @return rTokenAmount How many RToken `account` can issue given current holdings
    /// @return collateralTokens The tokens that `account` must deposit to issue RToken
    /// @return collateralAmounts The quantities of `collateralTokens` that `account` must deposit
    /// @custom:static-call
    function _maxIssuable(IRToken rToken, address account)
        internal
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
