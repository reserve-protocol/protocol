// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";
import "contracts/plugins/trading/GnosisTrade.sol";

/// A simple core contract that deploys disposable trading contracts for Traders
contract BrokerP1 is ReentrancyGuardUpgradeable, ComponentP1, IBroker {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using Clones for address;

    uint48 public constant MAX_AUCTION_LENGTH = 604800; // {s} max valid duration - 1 week

    ITrade public tradeImplementation;

    IGnosis public gnosis;

    uint48 public auctionLength; // {s} the length of an auction

    bool public disabled;

    mapping(address => bool) private trades;

    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade tradeImplementation_,
        uint48 auctionLength_
    ) external initializer {
        require(address(gnosis_) != address(0), "invalid Gnosis address");
        require(
            address(tradeImplementation_) != address(0),
            "invalid Trade Implementation address"
        );
        __Component_init(main_);
        gnosis = gnosis_;
        tradeImplementation = tradeImplementation_;
        setAuctionLength(auctionLength_);
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @dev Requires setting an allowance in advance
    /// @custom:interaction CEI
    function openTrade(TradeRequest memory req) external notPausedOrFrozen returns (ITrade) {
        require(!disabled, "broker disabled");

        address caller = _msgSender();
        require(
            caller == address(main.backingManager()) ||
                caller == address(main.rsrTrader()) ||
                caller == address(main.rTokenTrader()),
            "only traders"
        );

        // In the future we'll have more sophisticated choice logic here, probably by trade size
        GnosisTrade trade = GnosisTrade(address(tradeImplementation).clone());
        trades[address(trade)] = true;

        // == Interactions ==
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            caller,
            address(trade),
            req.sellAmount
        );

        trade.init(this, caller, gnosis, auctionLength, req);
        return trade;
    }

    /// Disable the broker until re-enabled by governance
    /// @custom:protected
    function reportViolation() external notPausedOrFrozen {
        require(trades[_msgSender()], "unrecognized trade contract");
        emit DisabledSet(disabled, true);
        disabled = true;
    }

    // === Setters ===

    /// @custom:governance
    function setAuctionLength(uint48 newAuctionLength) public governance {
        require(
            newAuctionLength > 0 && newAuctionLength <= MAX_AUCTION_LENGTH,
            "invalid auctionLength"
        );
        emit AuctionLengthSet(auctionLength, newAuctionLength);
        auctionLength = newAuctionLength;
    }

    /// @custom:governance
    function setDisabled(bool disabled_) external governance {
        emit DisabledSet(disabled, disabled_);
        disabled = disabled_;
    }
}
