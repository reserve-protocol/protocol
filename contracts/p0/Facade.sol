// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title FacadeP0
 * @notice A UX-friendly layer that for all the non-governance protocol functions
 */
contract FacadeP0 is IFacade {
    using FixLib for Fix;

    MainP0 public main;

    constructor(address main_) {
        main = MainP0(main_);
    }

    function runAuctionsForAllTraders() external {
        main.backingManager().manageFunds();
        main.rsrTrader().manageFunds();
        main.rTokenTrader().manageFunds();
    }

    function claimRewards() external {
        main.backingManager().claimAndSweepRewards();
        main.rsrTrader().claimAndSweepRewards();
        main.rTokenTrader().claimAndSweepRewards();
        main.rToken().claimAndSweepRewards();
    }

    function doFurnaceMelting() external {
        main.furnace().melt();
    }

    function ensureBasket() external {
        main.basketHandler().ensureBasket();
    }

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view returns (uint256) {
        return main.issuer().maxIssuable(account);
    }

    function currentBacking()
        external
        view
        returns (address[] memory tokens, uint256[] memory quantities)
    {
        tokens = main.basketHandler().tokens();
        quantities = new uint256[](tokens.length);

        for (uint256 j = 0; j < tokens.length; j++) {
            quantities[j] += IERC20(tokens[j]).balanceOf(address(main.backingManager()));
        }
    }

    /// @return total {UoA} An estimate of the total value of all assets held
    function totalAssetValue() external view returns (Fix total) {
        IAssetRegistry reg = main.assetRegistry();
        address backingManager = address(main.backingManager());

        IERC20[] memory erc20s = reg.erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = reg.toAsset(erc20s[i]);
            // Exclude collateral that has defaulted
            if (
                !asset.isCollateral() || reg.toColl(erc20s[i]).status() != CollateralStatus.DISABLED
            ) {
                uint256 bal = erc20s[i].balanceOf(backingManager);

                // {UoA/tok} = {UoA/tok} * {qTok} / {qTok/tok}
                Fix p = asset.fromQ(asset.price().mulu(bal));
                total = total.plus(p);
            }
        }
    }
}
