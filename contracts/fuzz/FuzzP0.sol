// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

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

contract BrokerP0Fuzz is BrokerP0 {
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
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}

// ================ Main ================
contract MainP0Fuzz is IMainFuzz, MainP0 {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal aliasedAddrs;
    mapping(address => address) public aliases; // The map of senders

    uint256 public seed;
    IMarketMock public marketMock;

    // ==== Scenario handles ====
    function translateAddr(address addr) public view returns (address) {
        return aliases[addr] != address(0) ? aliases[addr] : addr;
    }

    // From now on, translateAddr will pretend that `realSender` is `pretendSender`
    function spoof(address realSender, address pretendSender) external {
        aliasedAddrs.add(realSender);
        aliases[realSender] = pretendSender;
    }

    // Stop pretending that `realSender` is some other address
    function unspoof(address realSender) external {
        aliasedAddrs.remove(realSender);
        aliases[realSender] = address(0);
    }

    // Debugging getter
    function aliasValues() external view returns (address[] memory from, address[] memory to) {
        from = aliasedAddrs.values();
        to = new address[](aliasedAddrs.length());
        for (uint256 i = 0; i < aliasedAddrs.length(); i++) {
            to[i] = aliases[aliasedAddrs.at(i)];
        }
    }

    function setSeed(uint256 seed_) public {
        seed = seed_;
    }

    function initForFuzz(
        Components memory components,
        IERC20 rsr,
        uint32 freezerDuration,
        IMarketMock marketMock_
    ) public virtual initializer {
        init(components, rsr, freezerDuration);
        marketMock = marketMock_;
    }
}
