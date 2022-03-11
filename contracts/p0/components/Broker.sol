// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/plugins/trading/GnosisTrade.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/p0/mixins/Component.sol";

/// A simple core contract that deploys disposable trading contracts for Traders
contract BrokerP0 is Component, IBroker {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20Metadata;

    IGnosisEasyAuction public gnosis;

    EnumerableSet.AddressSet private trades;

    uint256 public auctionLength; // {s} the length of an auction

    bool public disabled;

    function init(ConstructorArgs calldata args) internal override {
        gnosis = args.gnosis;
        auctionLength = args.params.auctionLength;
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @dev Requires setting an allowance in advance
    function initiateTrade(TradeRequest memory req) external returns (ITrade) {
        require(!disabled, "broker disabled");
        req.sell.erc20().safeTransferFrom(msg.sender, address(this), req.sellAmount);

        // In the future we'll have more sophisticated choice logic here, probably by trade size
        GnosisTrade trade = new GnosisTrade();
        trades.add(address(trade));
        trade.init(this, msg.sender, gnosis, auctionLength, req);
        req.sell.erc20().safeTransfer(address(trade), req.sellAmount);
        return trade;
    }

    /// Disable the broker
    function snitch() external {
        require(
            msg.sender == address(main.backingManager()) ||
                msg.sender == address(main.rsrTrader()) ||
                msg.sender == address(main.rTokenTrader())
        );
        require(trades.contains(msg.sender), "unrecognized trade contract");
        emit TradingDisabled(disabled);
        disabled = true;
    }

    // === Setters ===

    function setAuctionLength(uint256 newAuctionLength) external onlyOwner {
        emit AuctionLengthSet(auctionLength, newAuctionLength);
        auctionLength = newAuctionLength;
    }

    function enable() external onlyOwner {
        emit TradingEnabled(disabled);
        disabled = false;
    }
}
