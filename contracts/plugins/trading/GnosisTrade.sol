// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IGnosis.sol";
import "contracts/interfaces/ITrade.sol";

enum TradeStatus {
    NOT_STARTED,
    OPEN,
    CLOSED
}

/// Trade contract against the Gnosis EasyAuction mechanism
contract GnosisTrade is ITrade {
    using FixLib for int192;
    using SafeERC20 for IERC20;

    IGnosis public gnosis;

    uint256 public auctionId; // An auction id from gnosis

    TradeStatus public status;

    IBroker public broker;

    // === Pricing ===
    address public origin;
    IERC20 public sell;
    IERC20 public buy;
    uint256 public sellAmount; // {qTok}
    uint256 public endTime;
    int192 public worstCasePrice; // {buyTok/sellTok}

    /// Constructor function, can only be called once
    /// @dev Expects sell tokens to already be present
    function init(
        IBroker broker_,
        address origin_,
        IGnosis gnosis_,
        uint256 auctionLength,
        TradeRequest memory req
    ) external {
        require(status == TradeStatus.NOT_STARTED, "trade already started");
        require(req.sell.erc20().balanceOf(address(this)) >= req.sellAmount, "unfunded trade");
        status = TradeStatus.OPEN;

        broker = broker_;
        origin = origin_;
        gnosis = gnosis_;
        endTime = block.timestamp + auctionLength;

        sell = req.sell.erc20();
        buy = req.buy.erc20();
        sellAmount = sell.balanceOf(address(this));
        worstCasePrice = toFix(req.minBuyAmount).divu(sellAmount);

        sell.approve(address(gnosis), sellAmount);
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
    }

    /// @return True if the trade can be settled; should be guaranteed to be true eventually
    function canSettle() public view returns (bool) {
        return status == TradeStatus.OPEN && endTime <= block.timestamp;
    }

    /// Settle trade, transfer tokens to trader, and report bad trade if needed
    function settle() external returns (uint256 soldAmt, uint256 boughtAmt) {
        require(msg.sender == origin, "only origin can settle");
        assert(status == TradeStatus.OPEN);
        require(canSettle(), "cannot settle yet");
        status = TradeStatus.CLOSED;

        // Optionally process settlement of the auction in Gnosis
        if (atStageSolutionSubmission()) {
            gnosis.settleAuction(auctionId);
        }

        assert(atStageFinished());

        // Check clearing prices
        uint256 sellBal = sell.balanceOf(address(this));
        boughtAmt = buy.balanceOf(address(this));
        if (sellBal < sellAmount) {
            soldAmt = sellAmount - sellBal;
            int192 clearingPrice = toFix(boughtAmt).divu(soldAmt); // {buyTok/sellTok}
            if (clearingPrice.lt(worstCasePrice)) {
                broker.reportViolation();
            }
        }

        // Transfer balances to origin, ending our watch
        if (sellBal > 0) sell.safeTransfer(origin, sellBal);
        if (boughtAmt > 0) buy.safeTransfer(origin, boughtAmt);
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
