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

    function settleTradeS() public {
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

// ================ Main ================
contract MainP0Fuzz is IMainFuzz, MainP0 {
    using EnumerableSet for EnumerableSet.AddressSet;

    IMarketMock public marketMock;

    EnumerableSet.AddressSet internal aliasedAddrs;
    mapping(address => address) public aliases; // The map of senders

    IERC20[] public tokens; // token addresses, not including RSR or RToken
    address[] public users; // "registered" user addresses
    address[] public constAddrs; // constant addresses, for "addrById"


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

    function numTokens() public view returns (uint256) {
        return tokens.length;
    }

    // Add a token to this system's tiny token registry
    function addToken(IERC20 token) public {
        tokens.push(token);
    }

    function someToken(uint256 seed) public view returns (IERC20) {
        uint256 id = seed % (tokens.length + 2);
        if (id < tokens.length) return tokens[id];
        else id -= tokens.length;

        if (id == 0) return IERC20(address(rsr));
        if (id == 1) return IERC20(address(rToken));
        revert("invalid id in someToken");
    }

    function numUsers() public view returns (uint256) {
        return users.length;
    }

    function addUser(address user) public {
        users.push(user);
    }

    function someAddr(uint256 seed) public view returns (address) {
        // constAddrs.length: constant addresses, mostly deployed contracts
        // numUsers: addresses from the user registry
        // 1: broker's "last deployed address"
        uint256 numIDs = numUsers() + constAddrs.length + 1;
        uint256 id = seed % numIDs;

        if (id < numUsers()) return users[id];
        else id -= numUsers();

        if (id < constAddrs.length) return constAddrs[id];
        else id -= constAddrs.length;

        if (id == 0) return address(0); // broker.lastOpenedTrade();
        revert("invalid id in someAddr");
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
