// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IGnosis.sol";
import "contracts/interfaces/ITrade.sol";

enum TradeStatus {
    NOT_STARTED, // before init()
    OPEN, // after init() and before settle()
    CLOSED, // after settle()
    PENDING // during init() or settle() (reentrancy protection)
}

/// Trade contract against the Gnosis EasyAuction mechanism
contract GnosisTrade is ITrade {
    using FixLib for int192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IGnosis public gnosis;

    uint256 public auctionId; // An auction id from gnosis

    TradeStatus public status;

    IBroker public broker;

    // === Pricing ===
    address public origin;
    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint256 public sellAmount; // {qTok}
    uint32 public endTime;
    int192 public worstCasePrice; // {buyTok/sellTok}

    /// Constructor function, can only be called once
    /// @dev Expects sell tokens to already be present
    /// @custom:interaction , Does NOT follow CEI!
    /// @dev Instead, this interaction is not at risk of rentrancy attacks
    ///      because it locks state while pending, and only calls interactions
    ///      of outer contracts
    function init(
        IBroker broker_,
        address origin_,
        IGnosis gnosis_,
        uint32 auctionLength,
        TradeRequest memory req
    ) external {
        require(status == TradeStatus.NOT_STARTED, "trade already started");
        require(req.sell.erc20().balanceOf(address(this)) >= req.sellAmount, "unfunded trade");
        assert(origin_ != address(0));
        status = TradeStatus.PENDING;

        broker = broker_;
        origin = origin_;
        gnosis = gnosis_;
        endTime = uint32(block.timestamp) + auctionLength;

        sell = req.sell.erc20();
        buy = req.buy.erc20();
        sellAmount = sell.balanceOf(address(this));

        // {buyTok/sellTok}
        worstCasePrice = shiftl_toFix(req.minBuyAmount, -int8(buy.decimals())).div(
            shiftl_toFix(sellAmount, -int8(sell.decimals()))
        );

        IERC20Upgradeable(address(sell)).safeIncreaseAllowance(address(gnosis), sellAmount);

        auctionId = gnosis.initiateAuction(
            sell,
            buy,
            endTime,
            endTime,
            uint96(sellAmount),
            uint96(req.minBuyAmount),
            0,
            req.minBuyAmount, // TODO to double-check this usage of gnosis later
            false,
            address(0),
            new bytes(0)
        );

        status = TradeStatus.OPEN;
    }

    /// @return True if the trade can be settled; should be guaranteed to be true eventually
    function canSettle() public view returns (bool) {
        return status == TradeStatus.OPEN && endTime <= block.timestamp;
    }

    /// Settle trade, transfer tokens to trader, and report bad trade if needed
    /// @custom:interaction , Does NOT follow CEI
    /// @dev Instead, this interaction is not at risk of reentrancy attacks
    ///      because it locks state while pending, and only calls interactions
    ///      of outer contracts
    function settle() external returns (uint256 soldAmt, uint256 boughtAmt) {
        require(msg.sender == origin, "only origin can settle");
        assert(status == TradeStatus.OPEN);
        status = TradeStatus.PENDING;

        // Optionally process settlement of the auction in Gnosis
        if (atStageSolutionSubmission()) {
            gnosis.settleAuction(auctionId);
        }

        assert(atStageFinished());

        // Transfer balances to origin
        uint256 sellBal = sell.balanceOf(address(this));
        boughtAmt = buy.balanceOf(address(this));

        if (sellBal > 0) IERC20Upgradeable(address(sell)).safeTransfer(origin, sellBal);
        if (boughtAmt > 0) IERC20Upgradeable(address(buy)).safeTransfer(origin, boughtAmt);

        // Check clearing prices
        if (sellBal < sellAmount) {
            soldAmt = sellAmount - sellBal;

            // {buyTok/sellTok}
            int192 clearingPrice = shiftl_toFix(boughtAmt, -int8(buy.decimals())).div(
                shiftl_toFix(soldAmt, -int8(sell.decimals()))
            );
            if (clearingPrice.lt(worstCasePrice)) {
                broker.reportViolation();
            }
        }
        status = TradeStatus.CLOSED;
    }

    /// Anyone can transfer any ERC20 back to the origin after the trade has been closed
    /// @dev Escape hatch for when trading partner freezes up, or other unexpected events
    /// @custom:interaction , CEI
    function transferToOriginAfterTradeComplete(IERC20 erc20) external {
        require(status == TradeStatus.CLOSED, "only after trade is closed");
        IERC20Upgradeable(address(erc20)).safeTransfer(origin, erc20.balanceOf(address(this)));
    }

    // === Private ===

    function atStageSolutionSubmission() private view returns (bool) {
        GnosisAuctionData memory data = gnosis.auctionData(auctionId);
        return data.auctionEndDate != 0 && data.clearingPriceOrder == bytes32(0);
    }

    function atStageFinished() private view returns (bool) {
        GnosisAuctionData memory data = gnosis.auctionData(auctionId);
        return data.clearingPriceOrder != bytes32(0);
    }
}
