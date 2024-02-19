// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IFacadeTest.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IStRSR.sol";
import "../libraries/Fixed.sol";

uint192 constant FIX_TWO = FIX_ONE * 2;

/**
 * @title FacadeTest
 * @notice A facade that is useful for driving/querying the system during testing.
 *   These functions should be generic to both P0 and P1.
 *
 * @custom:static-call - Use ethers callStatic() in order to get result after update
 */
// slither-disable-start
contract FacadeTest is IFacadeTest {
    using FixLib for uint192;

    /// Prompt all traders to run auctions
    /// Relatively gas-inefficient, shouldn't be used in production. Use multicall instead
    function runAuctionsForAllTraders(IRToken rToken) external {
        runAuctionsForAllTradersForKind(rToken, TradeKind.BATCH_AUCTION);
    }

    // Prompt all traders to run auctions of a specific kind
    function runAuctionsForAllTradersForKind(IRToken rToken, TradeKind kind) public {
        IMain main = rToken.main();
        IBackingManager backingManager = main.backingManager();
        IRevenueTrader rsrTrader = main.rsrTrader();
        IRevenueTrader rTokenTrader = main.rTokenTrader();
        IERC20[] memory erc20s = main.assetRegistry().erc20s();

        for (uint256 i = 0; i < erc20s.length; i++) {
            // BackingManager
            ITrade trade = backingManager.trades(erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                backingManager.settleTrade(erc20s[i]);
            }

            // RSRTrader
            trade = rsrTrader.trades(erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                rsrTrader.settleTrade(erc20s[i]);
            }

            // RTokenTrader
            trade = rTokenTrader.trades(erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                rTokenTrader.settleTrade(erc20s[i]);
            }
        }

        // solhint-disable no-empty-blocks
        try main.backingManager().rebalance(TradeKind.BATCH_AUCTION) {} catch {}
        try main.backingManager().forwardRevenue(erc20s) {} catch {}

        // Start exact RSR auctions
        (IERC20[] memory rsrERC20s, TradeKind[] memory rsrKinds) = traderERC20s(
            rsrTrader,
            kind,
            erc20s
        );
        try main.rsrTrader().manageTokens(rsrERC20s, rsrKinds) {} catch {}
        try main.rsrTrader().distributeTokenToBuy() {} catch {}

        // Start exact RToken auctions
        (IERC20[] memory rTokenERC20s, TradeKind[] memory rTokenKinds) = traderERC20s(
            rTokenTrader,
            kind,
            erc20s
        );
        try main.rTokenTrader().manageTokens(rTokenERC20s, rTokenKinds) {} catch {}
        try main.rTokenTrader().distributeTokenToBuy() {} catch {}
        // solhint-enable no-empty-blocks
    }

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    function claimRewards(IRToken rToken) external {
        IMain main = rToken.main();
        main.backingManager().claimRewards();
        main.rsrTrader().claimRewards();
        main.rTokenTrader().claimRewards();
    }

    /// Unlike Recollateralizationlib.totalAssetValue, this function _should_ yield a decreasing
    /// quantity through the rebalancing process due to slippage accruing during each trade.
    /// @return total {UoA} Point estimate of the value of all exogenous assets at BackingManager
    /// @custom:static-call
    function totalAssetValue(IRToken rToken) external returns (uint192 total) {
        IMain main = rToken.main();
        IAssetRegistry reg = main.assetRegistry();

        require(!main.frozen(), "frozen");

        // Poke Main
        reg.refresh();

        address backingManager = address(main.backingManager());
        IERC20 rsr = main.rsr();

        IERC20[] memory erc20s = reg.erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            // Skip RSR + RToken
            if (erc20s[i] == rsr || erc20s[i] == IERC20(address(rToken))) continue;

            IAsset asset = reg.toAsset(erc20s[i]);

            (uint192 lowPrice, uint192 highPrice) = asset.price();
            uint192 midPrice = lowPrice.plus(highPrice).divu(2);

            total = total.plus(asset.bal(backingManager).mul(midPrice));
        }
    }

    /// @param account The account to count baskets for
    /// @return {BU} The number of whole basket units held
    function wholeBasketsHeldBy(IRToken rToken, address account) external view returns (uint192) {
        BasketRange memory range = rToken.main().basketHandler().basketsHeldBy(account);
        return range.bottom;
    }

    // === Private ===

    function traderERC20s(
        IRevenueTrader trader,
        TradeKind kind,
        IERC20[] memory erc20sAll
    ) private view returns (IERC20[] memory erc20s, TradeKind[] memory kinds) {
        uint256 len;
        IERC20[] memory traderERC20sAll = new IERC20[](erc20sAll.length);
        for (uint256 i = 0; i < erc20sAll.length; ++i) {
            if (
                erc20sAll[i] != trader.tokenToBuy() &&
                address(trader.trades(erc20sAll[i])) == address(0) &&
                erc20sAll[i].balanceOf(address(trader)) > 1
            ) {
                traderERC20sAll[len] = erc20sAll[i];
                ++len;
            }
        }

        erc20s = new IERC20[](len);
        kinds = new TradeKind[](len);
        for (uint256 i = 0; i < len; ++i) {
            erc20s[i] = traderERC20sAll[i];
            kinds[i] = kind;
        }
    }
}
// slither-disable-end
