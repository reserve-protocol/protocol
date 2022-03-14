// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/Main.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title FacadeP0
 * @notice A UX-friendly layer for non-governance protocol interactions
 *
 * @dev
 * - @custom:bundle-action - Bundle multiple transactions to make sure they run on the same block
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
 * - @custom:view - Just expose a abstraction layer for getting protocol view data
 */
contract FacadeP0 is IFacade {
    using FixLib for Fix;

    MainP0 public main;

    constructor(address main_) {
        main = MainP0(main_);
    }

    /// Prompt all traders to run auctions
    /// @custom:bundle-action
    function runAuctionsForAllTraders() external {
        main.backingManager().manageFunds();
        main.rsrTrader().manageFunds();
        main.rTokenTrader().manageFunds();
    }

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    /// @custom:bundle-action
    function claimRewards() external {
        main.backingManager().claimAndSweepRewards();
        main.rsrTrader().claimAndSweepRewards();
        main.rTokenTrader().claimAndSweepRewards();
        main.rToken().claimAndSweepRewards();
    }

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(address account) external returns (uint256) {
        main.poke();
        return main.rToken().maxIssuable(account);
    }

    /// @return tokens Array of all known ERC20 asset addreses.
    /// @return amounts {qTok} Array of balance that the protocol holds of this current asset
    /// @custom:static-call
    function currentAssets() external returns (address[] memory tokens, uint256[] memory amounts) {
        main.poke();
        IAssetRegistry reg = main.assetRegistry();
        IERC20[] memory erc20s = reg.erc20s();

        tokens = new address[](erc20s.length);
        amounts = new uint256[](erc20s.length);

        for (uint256 i = 0; i < erc20s.length; i++) {
            tokens[i] = address(erc20s[i]);
            amounts[i] = erc20s[i].balanceOf(address(main.backingManager()));
        }
    }

    /// @return The exchange rate between StRSR and RSR as a Fix
    /// @custom:static-call
    function stRSRExchangeRate() external returns (Fix) {
        main.poke();
        return main.stRSR().exchangeRate();
    }

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue() external returns (Fix total) {
        main.poke();
        IAssetRegistry reg = main.assetRegistry();
        address backingManager = address(main.backingManager());

        IERC20[] memory erc20s = reg.erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = reg.toAsset(erc20s[i]);
            // Exclude collateral that has defaulted
            if (
                !asset.isCollateral() || reg.toColl(erc20s[i]).status() != CollateralStatus.DISABLED
            ) {
                total = total.plus(asset.bal(backingManager).mul(asset.price()));
            }
        }
    }

    /// @return tokens The addresses of the ERC20s backing the RToken
    /// @custom:view
    function basketTokens() external view returns (address[] memory tokens) {
        (tokens, ) = main.basketHandler().quote(FIX_ONE, RoundingApproach.ROUND);
    }
}
