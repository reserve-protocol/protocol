// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

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
contract FacadeTest is IFacadeTest {
    using FixLib for uint192;

    /// Prompt all traders to run auctions
    /// Relatively gas-inefficient, shouldn't be used in production. Use multicall instead
    function runAuctionsForAllTraders(IRToken rToken) external {
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

        main.backingManager().manageTokens(erc20s);
        for (uint256 i = 0; i < erc20s.length; i++) {
            rsrTrader.manageToken(erc20s[i]);
            rTokenTrader.manageToken(erc20s[i]);
        }
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
        main.poke();
        IAssetRegistry reg = main.assetRegistry();
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
}
