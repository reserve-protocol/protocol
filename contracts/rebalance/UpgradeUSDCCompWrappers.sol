// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ICToken } from "../plugins/assets/compoundv2/ICToken.sol";
import { CTokenWrapper } from "../plugins/assets/compoundv2/CTokenWrapper.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IMain } from "../interfaces/IMain.sol";
import { ICollateral } from "../interfaces/IAsset.sol";
import { DutchTrade, TradeKind, TradeStatus } from "../plugins/trading/DutchTrade.sol";
import { BackingManagerP1 } from "../p1/BackingManager.sol";
import { ICusdcV3Wrapper } from "../plugins/assets/compoundv3/ICusdcV3Wrapper.sol";
import { CometInterface } from "../plugins/assets/compoundv3/vendor/CometInterface.sol";

struct State {
    IMain main;
    uint256 bidAmount;
    uint256 sellAmount;
    uint256 sellAmountUnderlying;
    uint256 bidAmountUnderlying;
    IERC20Metadata buy;
    IERC20Metadata sell;
}

interface Vault {
    function flashLoan(
        address receiver,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external;
}

contract UpgradeUSDCCompWrappers {
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for ICToken;
    using SafeERC20 for CTokenWrapper;

    event Rebalance(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);

    Vault internal constant VAULT = Vault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    // USDC <-> ICToken <-> CTokenWrapper
    // USDC <-> CometInterface <-> ICusdcV3Wrapper
    IERC20Metadata internal constant USDC =
        IERC20Metadata(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    ICToken internal constant FUSDC = ICToken(0x39AA39c021dfbaE8faC545936693aC917d5E7563);

    CTokenWrapper internal constant FUSDC_VAULT =
        CTokenWrapper(0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022);

    CometInterface internal constant CUSDCV3 =
        CometInterface(0xc3d688B66703497DAA19211EEdff47f25384cdc3);

    ICusdcV3Wrapper internal constant OLD_CUSDCV3WRAPPER =
        ICusdcV3Wrapper(0x7e1e077b289c0153b5ceAD9F264d66215341c9Ab);

    ICusdcV3Wrapper internal constant NEW_CUSDCV3WRAPPER =
        ICusdcV3Wrapper(0x093c07787920eB34A0A0c7a09823510725Aee4Af);

    constructor() {
        USDC.safeApprove(address(FUSDC), type(uint256).max);
    }

    // Unwraps available 'token' into USDC
    function unwrap(address token) internal {
        if (token == address(FUSDC_VAULT)) {
            FUSDC_VAULT.withdraw(FUSDC_VAULT.balanceOf(address(this)), address(this));
            FUSDC.redeem(FUSDC.balanceOf(address(this)));
        } else if (token == address(OLD_CUSDCV3WRAPPER)) {
            OLD_CUSDCV3WRAPPER.withdraw(OLD_CUSDCV3WRAPPER.balanceOf(address(this)));
            CUSDCV3.withdraw(address(USDC), CUSDCV3.balanceOf(address(this)));
        } else if (token == address(NEW_CUSDCV3WRAPPER)) {
            NEW_CUSDCV3WRAPPER.withdraw(NEW_CUSDCV3WRAPPER.balanceOf(address(this)));
            CUSDCV3.withdraw(address(USDC), CUSDCV3.balanceOf(address(this)));
        } else if (token == address(FUSDC)) {
            FUSDC.redeem(FUSDC.balanceOf(address(this)));
        } else {
            revert("Invalid token");
        }
    }

    // Wraps available USDC into 'token'
    function wrap(address token) internal {
        if (token == address(FUSDC_VAULT)) {
            USDC.safeApprove(address(FUSDC), USDC.balanceOf(address(this)));
            FUSDC.mint(USDC.balanceOf(address(this)));

            FUSDC.safeApprove(address(FUSDC_VAULT), USDC.balanceOf(address(this)));
            FUSDC_VAULT.deposit(FUSDC.balanceOf(address(this)), address(this));
        } else if (token == address(NEW_CUSDCV3WRAPPER)) {
            USDC.safeApprove(address(CUSDCV3), USDC.balanceOf(address(this)));
            CUSDCV3.supply(address(USDC), USDC.balanceOf(address(this)));

            CUSDCV3.approve(address(NEW_CUSDCV3WRAPPER), CUSDCV3.balanceOf(address(this)));
            NEW_CUSDCV3WRAPPER.deposit(NEW_CUSDCV3WRAPPER.balanceOf(address(this)));
        } else if (token == address(OLD_CUSDCV3WRAPPER)) {
            USDC.safeApprove(address(CUSDCV3), USDC.balanceOf(address(this)));
            CUSDCV3.supply(address(USDC), USDC.balanceOf(address(this)));

            CUSDCV3.approve(address(OLD_CUSDCV3WRAPPER), CUSDCV3.balanceOf(address(this)));
            OLD_CUSDCV3WRAPPER.deposit(OLD_CUSDCV3WRAPPER.balanceOf(address(this)));
        } else if (token == address(FUSDC)) {
            USDC.safeApprove(address(FUSDC), USDC.balanceOf(address(this)));
            FUSDC.mint(USDC.balanceOf(address(this)));
        } else {
            revert("Invalid token");
        }
    }

    function wrappedToUnderlying(uint256 amt, address token) internal view returns (uint256) {
        if (token == address(FUSDC_VAULT)) {
            return (amt * FUSDC_VAULT.exchangeRateStored()) / 1e18;
        } else if (token == address(OLD_CUSDCV3WRAPPER)) {
            return OLD_CUSDCV3WRAPPER.convertStaticToDynamic(uint104(amt));
        } else if (token == address(FUSDC)) {
            return (amt * FUSDC.exchangeRateStored()) / 1e28;
        } else if (token == address(NEW_CUSDCV3WRAPPER)) {
            return NEW_CUSDCV3WRAPPER.convertStaticToDynamic(uint104(amt));
        } else {
            revert("Invalid token");
        }
    }

    function underlyingToWrapped(uint256 amt, address token) internal view returns (uint256) {
        if (token == address(FUSDC_VAULT)) {
            return (amt * 1e18) / FUSDC_VAULT.exchangeRateStored();
        } else if (token == address(OLD_CUSDCV3WRAPPER)) {
            return OLD_CUSDCV3WRAPPER.convertDynamicToStatic(amt);
        } else if (token == address(FUSDC)) {
            return (amt * 1e28) / FUSDC.exchangeRateStored();
        } else if (token == address(NEW_CUSDCV3WRAPPER)) {
            return NEW_CUSDCV3WRAPPER.convertDynamicToStatic(amt);
        } else {
            revert("Invalid token");
        }
    }

    function getState(IMain main, IERC20Metadata auctionFor) external view returns (State memory) {
        return _getState(main, auctionFor);
    }

    function _getState(IMain main, IERC20Metadata auctionFor) internal view returns (State memory) {
        State memory state;
        state.sell = auctionFor;
        state.main = main;
        DutchTrade trade = DutchTrade(
            address(BackingManagerP1(address(main.backingManager())).trades(IERC20(auctionFor)))
        );
        require(address(trade) != address(0), "Invalid trade");
        require(trade.KIND() == TradeKind.DUTCH_AUCTION, "Invalid trade type");
        require(trade.status() == TradeStatus.OPEN, "Invalid trade status");

        state.buy = trade.buy();
        state.bidAmount = trade.bidAmount(block.number);
        state.bidAmountUnderlying = wrappedToUnderlying(state.bidAmount, address(state.buy));

        state.sellAmount = trade.sellAmount();
        state.sellAmountUnderlying = wrappedToUnderlying(state.sellAmount, address(state.sell));
        return state;
    }

    function rebalance(IMain main, IERC20Metadata auctionFor) external {
        State memory state = _getState(main, auctionFor);
        require(state.bidAmountUnderlying <= state.sellAmountUnderlying, "Price too high");
        uint256 tokensIn = state.bidAmountUnderlying + state.bidAmountUnderlying / 40;
        uint256[] memory amounts = new uint256[](1);
        address[] memory tokens = new address[](1);
        tokens[0] = address(USDC);
        amounts[0] = tokensIn;

        VAULT.flashLoan(address(this), tokens, amounts, abi.encode(state));

        // Transfer remaining funds back to msg.sender
        USDC.safeTransfer(msg.sender, USDC.balanceOf(address(this)));
    }

    function receiveFlashLoan(
        IERC20Metadata[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory,
        bytes memory userData
    ) external {
        State memory state = abi.decode(userData, (State));
        uint256 tokensIn = amounts[0];
        DutchTrade trade = DutchTrade(
            address(
                BackingManagerP1(address(state.main.backingManager())).trades(IERC20(state.sell))
            )
        );
        wrap(address(state.buy));
        if (state.bidAmountUnderlying < state.sellAmountUnderlying) {
            uint256 amountToDonateUnderlying = state.sellAmountUnderlying -
                state.bidAmountUnderlying;
            state.buy.safeTransfer(
                address(trade),
                underlyingToWrapped(amountToDonateUnderlying, address(state.buy))
            );
        }

        // Bid on active dutch trade
        trade.bid();
        unwrap(address(state.sell));

        emit Rebalance(address(USDC), tokensIn, address(USDC), USDC.balanceOf(address(this)));

        // Pay back balancer
        tokens[0].safeTransfer(msg.sender, amounts[0]);
    }
}
