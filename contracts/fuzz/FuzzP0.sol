// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/TradeMock.sol";

import "contracts/p0/AssetRegistry.sol";
import "contracts/p0/BackingManager.sol";
import "contracts/p0/BasketHandler.sol";
import "contracts/p0/Broker.sol";
import "contracts/p0/Distributor.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/p0/StRSR.sol";

// ================ Components ================
// Every component must override _msgSender() in this one, common way!

contract AssetRegistryP0Fuzz is AssetRegistryP0 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract BasketHandlerP0Fuzz is BasketHandlerP0 {
    using BasketLib for Basket;
    Basket internal prev;

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function savePrev() external {
        prev.setFrom(basket);
    }

    function prevEqualsCurr() external view returns (bool) {
        uint256 n = basket.erc20s.length;
        if (n != prev.erc20s.length) return false;
        for (uint256 i = 0; i < n; i++) {
            if (prev.erc20s[i] != basket.erc20s[i]) return false;
            if (prev.refAmts[prev.erc20s[i]] != basket.refAmts[basket.erc20s[i]]) return false;
        }
        return true;
    }
}

contract BackingManagerP0Fuzz is BackingManagerP0 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract BrokerP0Fuzz is BrokerP0 {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using EnumerableSet for EnumerableSet.AddressSet;

    ITrade public lastOpenedTrade;
    EnumerableSet.AddressSet internal tradeSet;

    function _openTrade(TradeRequest memory req) internal virtual override returns (ITrade) {
        TradeMock trade = new TradeMock();
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            _msgSender(),
            address(trade),
            req.sellAmount
        );
        trade.init(IMainFuzz(address(main)), _msgSender(), auctionLength, req);
        lastOpenedTrade = trade;
        return trade;
    }

    function settleTrades() public {
        uint256 length = tradeSet.length();
        IMainFuzz m = IMainFuzz(address(main));
        for (uint256 i = 0; i < length; i++) {
            TradeMock trade = TradeMock(tradeSet.at(i));
            if (trade.canSettle()) {
                m.spoof(address(this), trade.origin());
                trade.settle();
                m.unspoof(address(this));
            }
        }
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract DistributorP0Fuzz is DistributorP0 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract FurnaceP0Fuzz is FurnaceP0 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract RevenueTraderP0Fuzz is RevenueTraderP0 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract RTokenP0Fuzz is IRTokenFuzz, RTokenP0 {
    using FixLib for uint192;
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
            : uint192(amount); // {qRTok / qRTok}

        return main.basketHandler().quote(baskets, roundingMode);
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

contract StRSRP0Fuzz is StRSRP0 {
    // A range of plausibly-valid IDs for withdraw()
    function idRange(address user) external view returns (uint256 left, uint256 right) {
        // left: index of first withdrawal with a nonzero balance (or .length)
        left = 0;
        while (left < withdrawals[user].length && withdrawals[user][left].rsrAmount > 0) left++;
        right = withdrawals[user].length;
    }

    /* function invariantsHold() external pure returns (bool) { */
    /*     // No similar failure mode to P1 StRSR to be tested here. */
    /*     return true; */
    /* } */

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}
