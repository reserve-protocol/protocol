// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../trading/GnosisTrade.sol";
import "../../interfaces/IBroker.sol";
import "../../interfaces/IMain.sol";
import "../../interfaces/ITrade.sol";
import "../../p0/mixins/Component.sol";

/// A simple core contract that deploys disposable trading contracts for Traders
contract InvalidBrokerMock is ComponentP0, IBroker {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20Metadata;

    IGnosis public gnosis;

    mapping(address => bool) private trades;

    uint48 public auctionLength; // {s} the length of an auction

    bool public disabled = false;

    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade,
        uint48 auctionLength_
    ) public initializer {
        __Component_init(main_);
        gnosis = gnosis_;
        auctionLength = auctionLength_;
    }

    /// Invalid implementation - Reverts
    function openTrade(TradeRequest memory req) external view notPausedOrFrozen returns (ITrade) {
        require(!disabled, "broker disabled");
        req;

        // Revert when opening trades
        revert("Failure opening trade");
    }

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function reportViolation() external {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function setAuctionLength(uint48 newAuctionLength) external governance {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function setDisabled(bool disabled_) external governance {}
}
