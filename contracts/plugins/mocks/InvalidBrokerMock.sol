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
contract InvalidBrokerMock is Component, IBroker {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20Metadata;

    IGnosis public gnosis;

    mapping(address => bool) private trades;

    uint256 public auctionLength; // {s} the length of an auction

    bool public disabled = false;

    function init(
        IMain main_,
        IGnosis gnosis_,
        uint256 auctionLength_
    ) public initializer {
        __Component_init(main_);
        gnosis = gnosis_;
        auctionLength = auctionLength_;
    }

    /// Invalid implementation - Reverts
    function openTrade(TradeRequest memory req) external view returns (ITrade) {
        require(!disabled, "broker disabled");
        require(
            _msgSender() == address(main.backingManager()) ||
                _msgSender() == address(main.rsrTrader()) ||
                _msgSender() == address(main.rTokenTrader()),
            "only traders"
        );

        req;

        // Revert when opening trades
        revert("Failure opening trade");
    }

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function reportViolation() external {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function setAuctionLength(uint256 newAuctionLength) external onlyOwner {}

    /// Dummy implementation
    /* solhint-disable no-empty-blocks */
    function setDisabled(bool disabled_) external onlyOwner {}
}
