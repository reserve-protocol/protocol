// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/mocks/ERC20Mock.sol";

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
        return IMainFuzz(address(main)).sender();
    }
}

// ================ Main ================
contract MainP0Fuzz is IMainFuzz, MainP0 {
    address[] internal senders;
    uint256 public seed;
    IMarketMock public marketMock;

    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    // ==== Scenario handles ====
    function sender() public view returns (address) {
        if (senders.length == 0) revert("IFuzz error: No sender set");
        return senders[senders.length - 1];
    }

    function pushSender(address s) public {
        senders.push(s);
    }

    function popSender() public {
        senders.pop();
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
