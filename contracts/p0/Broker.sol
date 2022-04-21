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
contract BrokerP0 is ComponentP0, IBroker {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20Metadata;

    IGnosis public gnosis;

    mapping(address => bool) private trades;

    uint32 public auctionLength; // {s} the length of an auction

    bool public disabled;

    // solhint-disable-next-line no-unused-vars
    function init(
        IMain main_,
        IGnosis gnosis_,
        // solhint-disable-next-line no-unused-vars
        ITrade tradeImplementation_, // Added for Interface compatibility with P1
        uint32 auctionLength_
    ) public initializer {
        __Component_init(main_);
        gnosis = gnosis_;
        auctionLength = auctionLength_;
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @dev Requires setting an allowance in advance
    function openTrade(TradeRequest memory req) external returns (ITrade) {
        require(!disabled, "broker disabled");
        require(
            _msgSender() == address(main.backingManager()) ||
                _msgSender() == address(main.rsrTrader()) ||
                _msgSender() == address(main.rTokenTrader()),
            "only traders"
        );

        // In the future we'll have more sophisticated choice logic here, probably by trade size
        GnosisTrade trade = new GnosisTrade();
        trades[address(trade)] = true;
        req.sell.erc20().safeTransferFrom(_msgSender(), address(trade), req.sellAmount);
        trade.init(this, _msgSender(), gnosis, auctionLength, req);
        return trade;
    }

    /// Disable the broker until re-enabled by governance
    function reportViolation() external {
        require(trades[_msgSender()], "unrecognized trade contract");
        emit DisabledSet(disabled, true);
        disabled = true;
    }

    // === Setters ===

    function setAuctionLength(uint32 newAuctionLength) external onlyOwner {
        emit AuctionLengthSet(auctionLength, newAuctionLength);
        auctionLength = newAuctionLength;
    }

    function setDisabled(bool disabled_) external onlyOwner {
        emit DisabledSet(disabled, disabled_);
        disabled = disabled_;
    }
}
