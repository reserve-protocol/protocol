// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacadeTest.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/libraries/Fixed.sol";

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
    function claimAndSweepRewards(IRToken rToken) external {
        IMain main = rToken.main();
        main.backingManager().claimRewards();
        main.rsrTrader().claimRewards();
        main.rTokenTrader().claimRewards();
        rToken.claimRewards();
        rToken.sweepRewards();
    }

    /// @return total {UoA} A low estimate of the total value of non-RSR assets at BackingManager
    /// @custom:static-call
    function totalAssetValue(IRToken rToken) external returns (uint192 total) {
        IMain main = rToken.main();
        main.poke();
        IAssetRegistry reg = main.assetRegistry();
        address backingManager = address(main.backingManager());
        IERC20 rsr = main.rsr();

        IERC20[] memory erc20s = reg.erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (erc20s[i] == rsr) continue;

            IAsset asset = reg.toAsset(erc20s[i]);

            (uint192 lowPrice, ) = asset.price();

            total = total.plus(asset.bal(backingManager).mul(lowPrice));
        }
    }
}
