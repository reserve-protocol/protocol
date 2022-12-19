// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IMarket.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";

contract RTokenMaker is Ownable {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    // For preventing delegatecalls to this contract's functions
    address public immutable self;

    constructor() Ownable() {
        self = address(this);
    }

    // For approving targets that can be safely called with delegatecall
    mapping(address => bool) public approvedTargets;

    function setApprovedTargets(address[] calldata targets, bool[] calldata isApproved)
        public
        onlyOwner
    {
        uint256 targetCount = targets.length;
        require(targetCount == isApproved.length, "RTokenMaker: MISMATCHED_ARRAY_LENGTHS");
        for (uint256 i = 0; i < targetCount; ++i) {
            approvedTargets[targets[i]] = isApproved[i];
        }
    }

    function issue(
        IERC20 fromToken,
        uint256 amountIn,
        IRToken rToken,
        uint256 minAmountOut,
        MarketCall[] calldata marketCalls,
        address receiver
    ) external payable returns (uint256 mintedAmount) {
        if (self != address(this)) revert TargetCallFailed(self, "INVALID_CALLER");
        if (amountIn == 0) revert InsufficientInput();
        if (receiver == address(0)) revert InvalidReceiver();

        if (address(fromToken) != address(0)) {
            fromToken.safeTransferFrom(_msgSender(), self, amountIn);
        }

        uint256 callCount = marketCalls.length;
        for (uint256 i = 0; i < callCount; ++i) {
            address target = marketCalls[i].target;
            if (!approvedTargets[target]) revert TargetNotApproved(target);

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returndata) = target.delegatecall(
                abi.encodeWithSelector(IMarket.enter.selector, marketCalls[i])
            );
            if (!success) revert TargetCallFailed(target, returndata);
        }

        (
            uint256 amountOut,
            address[] memory collateralTokens,
            uint256[] memory collateralAmounts
        ) = maxIssuable(rToken, self);
        if (amountOut < minAmountOut) revert InsufficientOutput();

        uint256 collateralCount = collateralTokens.length;
        for (uint256 i = 0; i < collateralCount; ++i) {
            IERC20(collateralTokens[i]).approve(address(rToken), collateralAmounts[i]);
        }

        return rToken.issue(receiver, amountOut);
    }

    function redeem(
        IRToken rToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        MarketCall[] calldata marketCalls,
        address receiver
    ) public payable returns (uint256 amountOut) {
        if (self != address(this)) revert TargetCallFailed(self, "INVALID_CALLER");
        if (amountIn == 0) revert InsufficientInput();
        if (receiver == address(0)) revert InvalidReceiver();

        uint256 initialBalance = _getBalance(toToken);

        IERC20(address(rToken)).safeTransferFrom(_msgSender(), self, amountIn);
        rToken.redeem(amountIn);

        uint256 callCount = marketCalls.length;
        for (uint256 i = 0; i < callCount; ++i) {
            address target = marketCalls[i].target;
            if (!approvedTargets[target]) revert TargetNotApproved(target);

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returndata) = target.delegatecall(
                abi.encodeWithSelector(IMarket.enter.selector, marketCalls[i])
            );
            if (!success) revert TargetCallFailed(target, returndata);
        }

        amountOut = _getBalance(toToken) - initialBalance;
        if (amountOut < minAmountOut) revert InsufficientOutput();

        if (address(toToken) == address(0)) {
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

    function _getBalance(IERC20 token) internal view returns (uint256) {
        if (address(token) == address(0)) {
            return self.balance;
        } else {
            return token.balanceOf(self);
        }
    }
}
