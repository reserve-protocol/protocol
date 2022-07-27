// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "contracts/interfaces/ITrade.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/TradeMock.sol";

import "contracts/p1/Broker.sol";
import "contracts/p1/Main.sol";
import "contracts/p1/RToken.sol";

// ================ Components ================
// Every component must override _msgSender() in this one, common way!

contract BrokerP1Fuzz is BrokerP1 {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function _openTrade(TradeRequest memory req) internal virtual override returns (ITrade) {
        TradeMock trade = new TradeMock();
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            _msgSender(),
            address(trade),
            req.sellAmount
        );
        trade.init(IMainFuzz(address(main)), _msgSender(), auctionLength, req);
        return trade;
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract RTokenP1Fuzz is IRTokenFuzz, RTokenP1 {
    using FixLib for uint192;

    // To be called only from MarketMock; this only works if MarketMock never enqueues any other
    // issuances.
    function fastIssue(uint256 amtRToken) external notPausedOrFrozen {
        require(amtRToken > 0, "Cannot issue zero");
        // TODO: Accept tokens first
        issue(amtRToken);

        IssueQueue storage queue = issueQueues[_msgSender()];
        if (queue.right > queue.left) {
            // We pushed a slow issuance, so rewrite that to be available now, and then vest it.
            queue.items[queue.right - 1].when = 0;
            vestUpTo(_msgSender(), queue.right);
        }
    }

    /// The tokens and underlying quantities needed to issue `amount` qRTokens.
    /// @dev this is distinct from basketHandler().quote() b/c the input is in RTokens, not BUs.
    /// @param amount {qRTok} quantity of qRTokens to quote.
    function quote(uint256 amount, RoundingMode roundingMode)
        external
        view
        returns (address[] memory tokens, uint256[] memory amts)
    {
        uint192 baskets = (totalSupply() > 0)
            ? basketsNeeded.muluDivu(amount, totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        return main.basketHandler().quote(baskets, roundingMode);
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

// ================ Main ================
// prettier-ignore
contract MainP1Fuzz is IMainFuzz, MainP1 {
    address public sender;
    uint256 public seed;
    IMarketMock public marketMock;

    function setSender(address sender_) public { sender = sender_; }
    function setSeed(uint256 seed_) public { seed = seed_; }

    // Avoiding overloading here, just because it's super annoying to deal with in ethers.js
    function initForFuzz(
        Components memory components,
        IERC20 rsr,
        uint32 freezerDuration,
        IMarketMock marketMock_
    ) public virtual {
        init(components, rsr, freezerDuration);
        marketMock = marketMock_;
    }
}
