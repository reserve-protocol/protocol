// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IBackingManager.sol";
import "../../interfaces/IRevenueTrader.sol";
import "../../interfaces/ITrade.sol";
import "../../interfaces/ITrading.sol";
import "../../plugins/trading/DutchTrade.sol";
import "../../plugins/trading/GnosisTrade.sol";
import "../../libraries/Fixed.sol";

library FacetLib {
    using Address for address;
    using FixLib for uint192;

    function getSellAmount(ITrade trade) internal view returns (uint256) {
        if (trade.KIND() == TradeKind.DUTCH_AUCTION) {
            return
                DutchTrade(address(trade)).sellAmount().shiftl_toUint(
                    int8(trade.sell().decimals())
                );
        } else if (trade.KIND() == TradeKind.BATCH_AUCTION) {
            return GnosisTrade(address(trade)).initBal();
        } else {
            revert("invalid trade type");
        }
    }

    function settleTrade(ITrading trader, IERC20 toSettle) internal {
        bytes1 majorVersion = bytes(trader.version())[0];
        if (majorVersion == bytes1("3") || majorVersion == bytes1("4")) {
            // Settle auctions
            trader.settleTrade(toSettle);
        } else if (majorVersion == bytes1("2") || majorVersion == bytes1("1")) {
            address(trader).functionCall(abi.encodeWithSignature("settleTrade(address)", toSettle));
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function forwardRevenue(IBackingManager bm, IERC20[] memory toStart) internal {
        bytes1 majorVersion = bytes(bm.version())[0];
        // Need to use try-catch here in order to still show revenueOverview when basket not ready
        if (majorVersion == bytes1("3") || majorVersion == bytes1("4")) {
            // solhint-disable-next-line no-empty-blocks
            try bm.forwardRevenue(toStart) {} catch {}
        } else if (majorVersion == bytes1("2") || majorVersion == bytes1("1")) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(bm).call{ value: 0 }(
                abi.encodeWithSignature("manageTokens(address[])", toStart)
            );
            success = success; // hush warning
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] memory toStart,
        TradeKind[] memory kinds
    ) internal {
        bytes1 majorVersion = bytes(revenueTrader.version())[0];

        if (majorVersion == bytes1("3") || majorVersion == bytes1("4")) {
            revenueTrader.manageTokens(toStart, kinds);
        } else if (majorVersion == bytes1("2") || majorVersion == bytes1("1")) {
            for (uint256 i = 0; i < toStart.length; ++i) {
                address(revenueTrader).functionCall(
                    abi.encodeWithSignature("manageToken(address)", toStart[i])
                );
            }
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function rebalance(IBackingManager bm, TradeKind kind) internal {
        bytes1 majorVersion = bytes(bm.version())[0];

        if (majorVersion == bytes1("3") || majorVersion == bytes1("4")) {
            // solhint-disable-next-line no-empty-blocks
            try bm.rebalance(kind) {} catch {}
        } else if (majorVersion == bytes1("2") || majorVersion == bytes1("1")) {
            IERC20[] memory emptyERC20s = new IERC20[](0);
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(bm).call{ value: 0 }(
                abi.encodeWithSignature("manageTokens(address[])", emptyERC20s)
            );
            success = success; // hush warning
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function _revertUnrecognizedVersion() internal pure {
        revert("unrecognized version");
    }
}
