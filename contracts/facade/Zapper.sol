// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ERC2771Context } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import { IWrappedNative } from "../interfaces/IWrappedNative.sol";
import { Call, ZapERC20Params } from "../interfaces/IRTokenZapper.sol";
import { IPermit2, SignatureTransferDetails, PermitTransferFrom } from "../interfaces/IPermit2.sol";

contract ZapperExecutor {
    receive() external payable {}

    /** @dev Main endpoint to call
     * @param calls - Each call to execute
     */
    function execute(Call[] calldata calls) external {
        uint256 len = calls.length;
        for (uint256 i; i < len; i++) {
            if (calls[i].value == 0) {
                Address.functionCall(calls[i].to, calls[i].data);
            } else {
                Address.functionCallWithValue(calls[i].to, calls[i].data, calls[i].value);
            }
        }
    }

    /** @dev Utility for returning remaining funds back to user
     * @param tokens - Tokens to move out of the ZapperExecutor contract
     * @param destination - Recipient of the ERC20 transfers
     */
    function drainERC20s(IERC20[] calldata tokens, address destination) external {
        uint256 len = tokens.length;
        for (uint256 i; i < len; i++) {
            IERC20 token = tokens[i];
            uint256 balance = token.balanceOf(address(this));
            if (balance == 0) {
                continue;
            }
            SafeERC20.safeTransfer(token, destination, balance);
        }
    }

    /** @dev Utility for setting up all neccesary approvals for Zap
     * @param tokens - Tokens to set up approvals
     * @param spenders - Spenders - i'th token will be approved for i'th spender
     */
    function setupApprovals(IERC20[] calldata tokens, address[] calldata spenders) external {
        require(tokens.length == spenders.length, "Invalid params");
        uint256 len = tokens.length;
        for (uint256 i; i < len; i++) {
            IERC20 token = tokens[i];
            address spender = spenders[i];

            uint256 allowance = token.allowance(address(this), spender);

            if (allowance != 0) {
                continue;
            }
            SafeERC20.safeApprove(token, spender, type(uint256).max);
        }
    }

    /** Callbacks added to allow the executor to directly trade with uniswapv3-like pools */
    function algebraSwapCallback(
        int256,
        int256,
        bytes calldata data
    ) external {
        this.execute(abi.decode(data, (Call[])));
    }

    function uniswapV3SwapCallback(
        int256,
        int256,
        bytes calldata data
    ) external {
        this.execute(abi.decode(data, (Call[])));
    }

    function swapCallback(
        int256,
        int256,
        bytes calldata data
    ) external {
        this.execute(abi.decode(data, (Call[])));
    }
}

contract Zapper is ReentrancyGuard {
    IWrappedNative internal immutable wrappedNative;
    IPermit2 internal immutable permit2;
    ZapperExecutor internal immutable zapperExecutor;

    constructor(
        IWrappedNative wrappedNative_,
        IPermit2 permit2_,
        ZapperExecutor executor_
    ) {
        wrappedNative = wrappedNative_;
        permit2 = permit2_;
        zapperExecutor = executor_;
    }

    function zapERC20_(ZapERC20Params calldata params) internal {
        uint256 initialBalance = params.tokenOut.balanceOf(msg.sender);
        // STEP 1: Execute
        zapperExecutor.execute(params.commands);

        // STEP 2: Verify that the user has gotten the tokens they requested
        uint256 newBalance = params.tokenOut.balanceOf(msg.sender);
        require(newBalance > initialBalance, "INVALID_NEW_BALANCE");
        uint256 difference = newBalance - initialBalance;
        require(difference >= params.amountOut, "INSUFFICIENT_OUT");
    }

    receive() external payable {
        require(msg.sender == address(wrappedNative), "INVALID_CALLER");
    }

    function zapERC20(ZapERC20Params calldata params) external nonReentrant {
        require(params.amountIn != 0, "INVALID_INPUT_AMOUNT");
        require(params.amountOut != 0, "INVALID_OUTPUT_AMOUNT");
        SafeERC20.safeTransferFrom(
            params.tokenIn,
            msg.sender,
            address(zapperExecutor),
            params.amountIn
        );
        zapERC20_(params);
    }

    function zapERC20WithPermit2(
        ZapERC20Params calldata params,
        PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant {
        require(params.amountIn != 0, "INVALID_INPUT_AMOUNT");
        require(params.amountOut != 0, "INVALID_OUTPUT_AMOUNT");

        permit2.permitTransferFrom(
            permit,
            SignatureTransferDetails({
                to: address(zapperExecutor),
                requestedAmount: params.amountIn
            }),
            msg.sender,
            signature
        );

        zapERC20_(params);
    }

    function zapETH(ZapERC20Params calldata params) external payable nonReentrant {
        require(address(params.tokenIn) == address(wrappedNative), "INVALID_INPUT_TOKEN");
        require(params.amountIn == msg.value, "INVALID_INPUT_AMOUNT");
        require(msg.value != 0, "INVALID_INPUT_AMOUNT");
        require(params.amountOut != 0, "INVALID_OUTPUT_AMOUNT");
        wrappedNative.deposit{ value: msg.value }();
        SafeERC20.safeTransfer(
            wrappedNative,
            address(zapperExecutor),
            wrappedNative.balanceOf(address(this))
        );
        zapERC20_(params);
    }
}
