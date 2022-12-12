// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/interfaces/IFacadeRead.sol";
import "contracts/interfaces/IMarket.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IWETH.sol";
import "contracts/p1/RToken.sol";

contract RTokenMarket is IMarket {
    using SafeERC20 for IERC20;
    IWETH public constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    IFacadeRead public immutable facadeRead;

    constructor(address _facadeRead) {
        facadeRead = IFacadeRead(_facadeRead);
    }

    function enter(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toRToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable override returns (uint256 amountOut) {
        require(amountIn != 0, "RTokenMarket: INSUFFICIENT_INPUT");
        require(receiver != address(0), "RTokenMarket: INVALID_RECEIVER");

        if (address(fromToken) == address(0)) {
            require(msg.value == amountIn, "RTokenMarket: INVALID_INPUT");
            WETH.deposit{ value: amountIn }();
            fromToken = WETH;
        } else {
            require(msg.value == 0, "RTokenMarket: INVALID_INPUT");
            fromToken.safeTransferFrom(msg.sender, address(this), amountIn);
        }

        IRToken rToken = RTokenP1(address(toRToken));
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();

        (address[] memory requiredTokens, uint256[] memory requiredTokenAmounts) = facadeRead.issue(
            rToken,
            minAmountOut
        );

        (uint256[] memory swapAmountIns, bytes[] memory swapCallDatas) = abi.decode(
            swapCallData,
            (uint256[], bytes[])
        );

        // Copying these values here to avoid stack too deep errors
        IERC20 fromTokenCopy = fromToken;
        address swapTargetCopy = swapTarget;

        // Caching this value
        uint256 requiredTokenCount = requiredTokens.length;
        require(
            requiredTokenCount == swapAmountIns.length &&
                requiredTokenCount == swapCallDatas.length,
            "RTokenMarket: INVALID_SWAP_CALL_DATA"
        );

        for (uint256 i = 0; i < requiredTokenCount; ++i) {
            IERC20 requiredToken = IERC20(requiredTokens[i]);
            uint256 requiredTokenAmount = requiredTokenAmounts[i];
            bytes memory swapCallDataCopy = swapCallDatas[i];
            IMarket market = assetRegistry.toColl(requiredToken).market();

            fromTokenCopy.approve(address(market), swapAmountIns[i]);
            // Use the return value of `market.enter` to approve the full amount of received tokens
            requiredToken.approve(
                address(rToken),
                market.enter(
                    fromTokenCopy,
                    swapAmountIns[i],
                    requiredToken,
                    requiredTokenAmount,
                    swapTargetCopy,
                    swapCallDataCopy,
                    address(this)
                )
            );
        }

        // Use the return value of `maxIssuable` to issue the maximum amount of RToken
        amountOut = rToken.issue(receiver, facadeRead.maxIssuable(rToken, address(this)));
        require(amountOut >= minAmountOut, "RTokenMarket: INSUFFICIENT_OUTPUT");
    }

    function exit(
        IERC20 fromRToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable returns (uint256 issuedAmount) {
        revert("RTokenMarket: NOT_IMPLEMENTED");
    }

    receive() external payable {
        // solhint-disable-next-line avoid-tx-origin
        require(msg.sender != tx.origin, "Do not send ETH directly");
    }
}
