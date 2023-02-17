// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/IWrappedNative.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IMain.sol";
import "../libraries/Fixed.sol";
import "../plugins/mocks/ERC20Mock.sol";

contract Zapper is ReentrancyGuard {
    using FixLib for uint192;
    address internal immutable wrappedNative;
    address internal constant _1INCH = 0x1111111254EEB25477B68fb85Ed929f73A960582;

    constructor(address weth) {
        wrappedNative = weth;
    }

    struct AggregatorTrade {
        // Encoded 1inch aggregator call
        bytes aggregatorCall;
        // Output token of this trade
        IERC20 basketToken;
    }

    struct ZapERC20Params {
        // Token to zap
        IERC20 tokenIn;
        // Total amount to zap / pull from user
        uint256 amountIn;
        // Aggregator trades to do to convert user tokens
        AggregatorTrade[] trades;
        // RTokens the user requested
        uint256 amountOut;
        // RToken to issue
        IRToken tokenOut;
    }

    function pullFunds(IERC20 token, uint256 amount) internal {
        SafeERC20.safeTransferFrom(token, msg.sender, address(this), amount);
    }

    function transfer(
        address token,
        address to,
        uint256 amount
    ) internal {
        SafeERC20.safeTransfer(IERC20(token), to, amount);
    }

    function setupApprovalFor(IERC20 token, address spender) internal {
        uint256 allowance = token.allowance(address(this), spender);
        if (allowance != 0) {
            return;
        }
        SafeERC20.safeApprove(IERC20(token), spender, type(uint256).max);
    }

    function zapToBasketToken(AggregatorTrade memory params) internal {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory reason) = _1INCH.call(params.aggregatorCall);
        if (success) {
            return;
        }
        // solhint-disable-next-line no-inline-assembly
        assembly {
            revert(add(reason, 32), mload(reason))
        }
        // ^ This is the correct way of handling a revert from a lowlevel
        // So disabling solhint
    }

    function zapERC20_(ZapERC20Params calldata params) internal {
        pullFunds(params.tokenIn, params.amountIn);
        setupApprovalFor(params.tokenIn, _1INCH);
        {
            uint256 len = params.trades.length;
            for (uint256 i = 0; i < len; i++) {
                zapToBasketToken(params.trades[i]);
                setupApprovalFor(params.trades[i].basketToken, address(params.tokenOut));
            }
        }

        params.tokenOut.issueTo(msg.sender, params.amountOut);

        // If we got to here it means that we managed exchange user funds into rtokens
        // Last step is to refund any residuals left over from the trades
        {
            uint256 len = params.trades.length;
            for (uint256 i = 0; i < len; i++) {
                uint256 residual = params.trades[i].basketToken.balanceOf(address(this));
                if (residual == 0) {
                    continue;
                }
                transfer(address(params.trades[i].basketToken), msg.sender, residual);
            }
        }
        {
            uint256 residual = params.tokenIn.balanceOf(address(this));
            if (residual != 0) {
                transfer(address(params.tokenIn), msg.sender, residual);
            }
        }
    }

    receive() external payable {
        require(msg.sender == wrappedNative, "INVALID_CALLER");
    }

    function zapERC20(ZapERC20Params calldata params) external nonReentrant {
        require(params.amountIn != 0, "INVALID_INPUT_AMOUNT");
        require(params.amountOut != 0, "INVALIT_OUTPUT_AMOUNT");
        zapERC20_(params);
    }

    function zapETH(ZapERC20Params calldata params) external payable nonReentrant {
        require(address(params.tokenIn) == address(wrappedNative), "INVALID_INPUT_TOKEN");
        require(params.amountIn == msg.value, "INVALID_INPUT_AMOUNT");
        require(msg.value != 0, "INVALID_INPUT_AMOUNT");
        require(params.amountOut != 0, "INVALIT_OUTPUT_AMOUNT");
        IWrappedNative(wrappedNative).deposit{ value: msg.value }();
        zapERC20_(params);
    }

    /** Calculates basket token amounts needed to mint 'quantity' number of RTokens */
    function getInputTokens(
        uint256 quantity,
        IBasketHandler handler,
        IRToken token
    ) external view returns (address[] memory tokens, uint256[] memory amounts) {
        uint256 supply = token.totalSupply();
        uint192 amtBaskets = supply > 0
            ? token.basketsNeeded().muluDivu(quantity, supply, RoundingMode.CEIL)
            : _safeWrap(quantity);
        return handler.quote(amtBaskets, RoundingMode.CEIL);
    }
}

contract DemoRToken is ERC20 {
    constructor() ERC20("RSV", "RSV") {}

    function adminApprove(
        address owner,
        address spender,
        uint256 amount
    ) external {
        _approve(owner, spender, amount);
    }

    function issueTo(address recipient, uint256 amount) external {
        SafeERC20.safeTransferFrom(
            IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
            msg.sender,
            address(this),
            amount / 10**12 / 2
        );
        SafeERC20.safeTransferFrom(
            IERC20(0x4Fabb145d64652a948d72533023f6E7A623C7C53),
            msg.sender,
            address(this),
            amount / 2
        );
        _mint(recipient, amount);
    }

    function basketsNeeded() external pure returns (uint192) {
        return 0;
    }
}

contract DemoBasketHandler {
    function quote(uint192 amt, RoundingMode)
        external
        pure
        returns (address[] memory addrs, uint256[] memory amts)
    {
        addrs = new address[](2);
        addrs[0] = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
        addrs[1] = 0x4Fabb145d64652a948d72533023f6E7A623C7C53;
        amts = new uint256[](2);
        amts[0] = amt / 10**12 / 2;
        amts[1] = amt / 2;
    }
}
