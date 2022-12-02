// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IFacadeRead.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/p1/RToken.sol";

import "./BaseMarket.sol";

contract RTokenMarket is BaseMarket {
    using SafeERC20 for IERC20;

    IFacadeRead public immutable facadeRead;

    constructor(address _facadeRead) {
        facadeRead = IFacadeRead(_facadeRead);
    }

    function enter(
        address fromToken,
        uint256 amountIn,
        address toRToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable override whenNotPaused returns (uint256 rTokenAmount) {
        require(amountIn > 0, "RTokenMarket: INSUFFICIENT_INPUT");
        if (fromToken == address(0)) {
            require(msg.value == amountIn, "RTokenMarket: INVALID_INPUT");
            WETH.deposit{ value: amountIn }();
            fromToken = address(WETH);
        } else {
            require(msg.value == 0, "RTokenMarket: NONZERO_MESSAGE_VALUE");
            IERC20(fromToken).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(fromToken).safeApprove(swapTarget, amountIn);
        }

        // TODO: Issue maximum amount of rToken (instead of minAmountOut)
        RTokenP1 rToken = RTokenP1(toRToken);
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();

        // Grab the initial state to verify balance later
        uint256 initialBalance = rToken.balanceOf(address(this));
        IFacadeRead.Pending memory initialPending = facadeRead.lastPendingIssuance(
            rToken,
            address(this)
        );

        (address[] memory requiredTokens, uint256[] memory requiredTokenAmounts) = facadeRead.issue(
            rToken,
            minAmountOut
        );

        uint256 requiredTokenCount = requiredTokens.length;
        (uint256[] memory enterAmountIns, bytes[] memory swapCallDatas) = abi.decode(
            swapCallData,
            (uint256[], bytes[])
        );
        require(
            requiredTokenCount == enterAmountIns && requiredTokenCount == swapCallDatas.length,
            "RTokenMarket: INVALID_SWAP_CALL_DATA"
        );

        for (uint256 i = 0; i < requiredTokenCount; ++i) {
            IERC20 requiredToken = IERC20(requiredTokens[i]);

            IMarket market = assetRegistry.toColl(requiredToken).market();
            IERC20(fromToken).safeApprove(address(market), enterAmountIns[i]);
            requiredTokenAmounts[i] = market.enter(
                fromToken,
                enterAmountIns[i],
                address(requiredToken),
                requiredTokenAmounts[i],
                swapTarget,
                swapCallDatas[i],
                address(this)
            );
            IERC20(fromToken).safeApprove(address(market), 0);

            requiredToken.safeApprove(toRToken, requiredTokenAmounts[i]);
        }

        rToken.issue(minAmountOut);

        IFacadeRead.Pending memory latestPending = facadeRead.lastPendingIssuance(
            rToken,
            address(this)
        );

        // Given an instant issuance, transfer the tokens to the receiver
        if (initialPending.index == latestPending.index) {
            issuedAmount = rToken.balanceOf(address(this)) - initialBalance;
            rToken.transfer(receiver, issuedAmount);
        }

        require(issuedAmount >= minAmountOut, "RTokenMarket: INSUFFICIENT_OUTPUT");
    }
}
