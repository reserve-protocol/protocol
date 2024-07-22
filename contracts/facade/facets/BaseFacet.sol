// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IBackingManager.sol";
import "../../interfaces/IBasketHandler.sol";
import "../../interfaces/IRevenueTrader.sol";
import "../../interfaces/ITrade.sol";
import "../../interfaces/ITrading.sol";
import "../../plugins/trading/DutchTrade.sol";
import "../../plugins/trading/GnosisTrade.sol";
import "../../libraries/Fixed.sol";

// interfaces prior to 4.0.0
interface IOldBasketHandler {
    function price() external view returns (uint192 low, uint192 high);

    function quote(uint192 amount, RoundingMode rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities);
}

/// Base Facet contract with internal functions to provide version-generic API
// slither-disable-start
contract BaseFacet {
    using Address for address;
    using FixLib for uint192;

    function _getSellAmount(ITrade trade) internal view returns (uint256) {
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

    function _settleTrade(ITrading trader, IERC20 toSettle) internal {
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

    function _forwardRevenue(IBackingManager bm, IERC20[] memory toStart) internal {
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

    function _runRevenueAuctions(
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

    function _rebalance(IBackingManager bm, TradeKind kind) internal {
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

    function _quote(
        IBasketHandler basketHandler,
        uint192 amount,
        RoundingMode rounding
    ) internal view returns (address[] memory erc20s, uint256[] memory quantities) {
        bytes1 majorVersion = bytes(basketHandler.version())[0];

        if (majorVersion == bytes1("4")) {
            return basketHandler.quote(amount, rounding == CEIL, rounding);
        } else if (
            majorVersion == bytes1("3") ||
            majorVersion == bytes1("2") ||
            majorVersion == bytes1("1")
        ) {
            return IOldBasketHandler(address(basketHandler)).quote(amount, rounding);
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function _revertUnrecognizedVersion() internal pure {
        revert("unrecognized version");
    }
}
// slither-disable-end
