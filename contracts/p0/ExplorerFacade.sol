// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IAssetRegistry.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/IExplorerFacade.sol";

/**
 * @title ExplorerFacadeP0
 * @notice A UX-friendly layer that for all the non-governance protocol functions
 */
contract ExplorerFacadeP0 is IExplorerFacade {
    using FixLib for Fix;

    MainP0 public main;

    constructor(address main_) {
        main = MainP0(main_);
    }

    function runAuctionsForAllTraders() external override {
        main.backingManager().manageFunds();
        main.rsrTrader().manageFunds();
        main.rTokenTrader().manageFunds();
    }

    function claimRewards() external override {
        main.backingManager().claimAndSweepRewards();
        main.rsrTrader().claimAndSweepRewards();
        main.rTokenTrader().claimAndSweepRewards();
        // TODO main.rToken().claimAndSweepRewards()
    }

    function doFurnaceMelting() external override {
        main.revenueFurnace().melt();
    }

    function ensureValidBasket() external override {
        main.basketHandler().ensureValidBasket();
    }

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        return main.rTokenIssuer().maxIssuable(account);
    }

    function currentBacking()
        external
        view
        override
        returns (address[] memory tokens, uint256[] memory quantities)
    {
        tokens = main.rTokenIssuer().basketTokens();
        quantities = new uint256[](tokens.length);

        for (uint256 j = 0; j < tokens.length; j++) {
            quantities[j] += IERC20Metadata(tokens[j]).balanceOf(address(main));
        }
    }

    /// @return total {UoA} An estimate of the total value of all assets held
    function totalAssetValue() external view override returns (Fix total) {
        IAssetRegistry reg = main.assetRegistry();

        IERC20Metadata[] memory erc20s = reg.registeredERC20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = reg.toAsset(erc20s[i]);
            // Exclude collateral that has defaulted
            if (
                !asset.isCollateral() || reg.toColl(erc20s[i]).status() != CollateralStatus.DISABLED
            ) {
                uint256 bal = erc20s[i].balanceOf(address(main));

                // {UoA/tok} = {UoA/tok} * {qTok} / {qTok/tok}
                Fix p = asset.price().mulu(bal).shiftLeft(-int8(erc20s[i].decimals()));
                total = total.plus(p);
            }
        }
    }
}
