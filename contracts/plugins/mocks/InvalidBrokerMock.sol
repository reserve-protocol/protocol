// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

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

    uint48 public batchAuctionLength; // {s} the length of a batch auction
    uint48 public dutchAuctionLength; // {s} the length of a dutch auction

    bool public batchTradeDisabled = false;

    mapping(IERC20Metadata => bool) public dutchTradeDisabled;

    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade,
        uint48 batchAuctionLength_,
        ITrade,
        uint48 dutchAuctionLength_
    ) public initializer {
        __Component_init(main_);
        gnosis = gnosis_;
        batchAuctionLength = batchAuctionLength_;
        dutchAuctionLength = dutchAuctionLength_;
    }

    /// Invalid implementation - Reverts
    function openTrade(
        TradeKind,
        TradeRequest memory,
        TradePrices memory
    ) external view notTradingPausedOrFrozen returns (ITrade) {
        // Revert when opening trades
        revert("Failure opening trade");
    }

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function reportViolation() external {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function setBatchAuctionLength(uint48 newAuctionLength) external governance {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function setDutchAuctionLength(uint48 newAuctionLength) external governance {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function enableBatchTrade() external governance {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function enableDutchTrade(IERC20Metadata erc20) external governance {}
}
