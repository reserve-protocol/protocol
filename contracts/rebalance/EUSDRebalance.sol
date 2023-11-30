// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ICToken } from "../plugins/assets/compoundv2/ICToken.sol";
import { CTokenWrapper } from "../plugins/assets/compoundv2/CTokenWrapper.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { ICollateral } from "../interfaces/IAsset.sol";
import { DutchTrade, TradeKind, TradeStatus } from "../plugins/trading/DutchTrade.sol";
import { BackingManagerP1 } from "../p1/BackingManager.sol";

struct State {
    uint256 bidAmount;
    uint256 sellAmount;
    uint256 sellAmountUnderlying;
    uint256 bidAmountUnderlying;
    IERC20Metadata buy;
    ICToken sellToken;
    ICToken buyCToken;
    IERC20Metadata buyTokenUnderlying;
    address from;
}

interface Vault {
    function flashLoan(
        address receiver,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external;
}

contract EUSDRebalance is Ownable {
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for ICToken;
    using SafeERC20 for CTokenWrapper;

    event Rebalance(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);

    Vault internal constant VAULT = Vault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    IAssetRegistry internal constant ASSET_REG =
        IAssetRegistry(0x9B85aC04A09c8C813c37de9B3d563C2D3F936162);

    BackingManagerP1 internal constant BACKING_MGR =
        BackingManagerP1(0xF014FEF41cCB703975827C8569a3f0940cFD80A4);

    IERC20Metadata internal constant USDC =
        IERC20Metadata(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    IERC20Metadata internal constant USDT =
        IERC20Metadata(0xdAC17F958D2ee523a2206206994597C13D831ec7);

    ICToken internal constant CUSDC = ICToken(0x39AA39c021dfbaE8faC545936693aC917d5E7563);
    ICToken internal constant CUSDT = ICToken(0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9);

    CTokenWrapper internal constant CUSDC_VAULT =
        CTokenWrapper(0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022);
    CTokenWrapper internal constant CUSDT_VAULT =
        CTokenWrapper(0x4Be33630F92661afD646081BC29079A38b879aA0);

    constructor() {
        CUSDC.safeApprove(address(CUSDC_VAULT), type(uint256).max);
        CUSDT.safeApprove(address(CUSDT_VAULT), type(uint256).max);

        USDC.safeApprove(address(CUSDC), type(uint256).max);
        USDT.safeApprove(address(CUSDT), type(uint256).max);
    }

    function getState(ICToken sellToken) external view returns (State memory state) {
        state.sellToken = sellToken;
        require(sellToken == CUSDT || sellToken == CUSDC, "Invalid sell token");
        DutchTrade trade = DutchTrade(address(BACKING_MGR.trades(IERC20(sellToken))));
        require(address(trade) != address(0), "Invalid trade");
        require(trade.KIND() == TradeKind.DUTCH_AUCTION, "Invalid trade type");
        require(trade.status() == TradeStatus.OPEN, "Invalid trade status");

        state.buy = trade.buy();

        CTokenWrapper buyingVault = state.buy == CUSDT_VAULT ? CUSDT_VAULT : CUSDC_VAULT;
        state.bidAmount = trade.bidAmount(block.number);
        state.bidAmountUnderlying = (state.bidAmount * buyingVault.exchangeRateStored()) / 1e18;

        state.sellAmount = trade.sellAmount();
        state.sellAmountUnderlying = (state.sellAmount * sellToken.exchangeRateStored()) / 1e28;

        state.buyCToken = ICToken(address(buyingVault.underlying()));
        // (DutchAuctions go to mktPrice - 1.5%)
        // Pull underlying + 2.5% from user and convert into buytoken
        state.buyTokenUnderlying = IERC20Metadata(state.buyCToken.underlying());
    }

    function rebalance(address from, ICToken sellToken) external onlyOwner {
        State memory state;
        state.from = from;
        state.sellToken = sellToken;
        require(sellToken == CUSDT || sellToken == CUSDC, "Invalid sell token");
        DutchTrade trade = DutchTrade(address(BACKING_MGR.trades(IERC20(sellToken))));
        require(address(trade) != address(0), "Invalid trade");
        require(trade.KIND() == TradeKind.DUTCH_AUCTION, "Invalid trade type");
        require(trade.status() == TradeStatus.OPEN, "Invalid trade status");

        state.buy = trade.buy();

        CUSDC_VAULT.safeApprove(address(trade), type(uint256).max);
        CUSDT_VAULT.safeApprove(address(trade), type(uint256).max);

        CTokenWrapper buyingVault = state.buy == CUSDT_VAULT ? CUSDT_VAULT : CUSDC_VAULT;
        state.bidAmount = trade.bidAmount(block.number);
        state.bidAmountUnderlying = (state.bidAmount * buyingVault.exchangeRateStored()) / 1e18;

        state.sellAmount = trade.sellAmount();
        state.sellAmountUnderlying = (state.sellAmount * sellToken.exchangeRateStored()) / 1e28;

        require(state.bidAmountUnderlying <= state.sellAmountUnderlying, "Price too high");
        state.buyCToken = ICToken(address(buyingVault.underlying()));
        // (DutchAuctions go to mktPrice - 1.5%)
        // Pull underlying + 2.5% from user and convert into buytoken
        state.buyTokenUnderlying = IERC20Metadata(state.buyCToken.underlying());

        uint256 tokensIn = state.bidAmountUnderlying + state.bidAmountUnderlying / 40;
        uint256[] memory amounts = new uint256[](1);
        address[] memory tokens = new address[](1);
        tokens[0] = address(state.buyTokenUnderlying);
        amounts[0] = tokensIn;

        VAULT.flashLoan(address(this), tokens, amounts, abi.encode(state));
    }

    function receiveFlashLoan(
        IERC20Metadata[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory,
        bytes memory userData
    ) external {
        require(owner() == tx.origin, "Only EOA");
        require(msg.sender == address(VAULT), "Only vault");
        State memory state = abi.decode(userData, (State));
        require(tokens[0] == state.buyTokenUnderlying, "Invalid token");

        CTokenWrapper buyingVault = state.buy == CUSDT_VAULT ? CUSDT_VAULT : CUSDC_VAULT;
        uint256 tokensIn = amounts[0];
        DutchTrade trade = DutchTrade(address(BACKING_MGR.trades(IERC20(state.sellToken))));

        // state.buyTokenUnderlying.safeTransferFrom(state.from, address(this), tokensIn);

        state.buyCToken.mint(amounts[0]);

        buyingVault.deposit(buyingVault.underlying().balanceOf(address(this)), address(this));

        // If we get in at a lower price than 1:1, donate
        // profit to DutchTrade contract to avoid RSR auctions
        if (state.bidAmountUnderlying < state.sellAmountUnderlying) {
            // ICollateral buyingVaultCol = ICollateral(ASSET_REG.toColl(IERC20(buyingVault)));
            // Using refPerTok results in a $0.015 loss to the trader pr DutchTrade
            uint256 amountToDonateUnderlying = state.sellAmountUnderlying -
                state.bidAmountUnderlying;

            uint256 amountToDonate = (amountToDonateUnderlying * 1e18) /
                buyingVault.exchangeRateStored();
            // (buyingVaultCol.refPerTok() / 100);

            buyingVault.safeTransfer(address(trade), amountToDonate);
        }

        // Bid on active dutch trade
        trade.bid();

        // Redeem any leftovers
        CUSDC_VAULT.withdraw(CUSDC_VAULT.balanceOf(address(this)), address(this));
        CUSDC.redeem(CUSDC.balanceOf(address(this)));

        CUSDT_VAULT.withdraw(CUSDT_VAULT.balanceOf(address(this)), address(this));
        CUSDT.redeem(CUSDT.balanceOf(address(this)));

        emit Rebalance(
            address(state.sellToken.underlying()),
            tokensIn,
            address(state.buyTokenUnderlying),
            state.buyTokenUnderlying.balanceOf(address(this))
        );

        // Pay back balancer
        uint256 available = tokens[0].balanceOf(address(this));

        if (available > amounts[0]) {
            // Make sure to not overpay
            available = amounts[0];
        }

        if (available != 0) {
            // Start by using funds on contract
            tokens[0].safeTransfer(msg.sender, available);
        }

        // If we're short, pull from user
        if (available < amounts[0]) {
            tokens[0].safeTransferFrom(state.from, msg.sender, amounts[0] - available);
        }

        // Transfer remainers back to user
        USDC.safeTransfer(state.from, USDC.balanceOf(address(this)));
        USDT.safeTransfer(state.from, USDT.balanceOf(address(this)));
    }
}
