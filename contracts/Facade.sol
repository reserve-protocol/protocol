// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title Facade
 * @notice A UX-friendly layer for non-governance protocol interactions
 *
 * @dev
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
 * - @custom:view - Just expose a abstraction layer for getting protocol view data
 */
contract Facade is Initializable, IFacade {
    using FixLib for int192;

    IMain public main;

    constructor(IMain main_) {
        init(main_);
    }

    function init(IMain main_) public initializer {
        main = main_;
    }

    /// Prompt all traders to run auctions
    /// Relatively gas-inefficient, shouldn't be used in production. Use multicall instead
    /// @custom:action
    function runAuctionsForAllTraders() external {
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
    /// @custom:action
    function claimRewards() external {
        main.backingManager().claimAndSweepRewards();
        main.rsrTrader().claimAndSweepRewards();
        main.rTokenTrader().claimAndSweepRewards();
        main.rToken().claimAndSweepRewards();
    }

    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(address account) external returns (uint256) {
        main.poke();

        // {BU}
        int192 held = main.basketHandler().basketsHeldBy(account);
        int192 needed = main.rToken().basketsNeeded();

        int8 decimals = int8(main.rToken().decimals());

        // return {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
        if (needed.eq(FIX_ZERO)) return held.shiftl_toUint(decimals);

        int192 totalSupply = shiftl_toFix(main.rToken().totalSupply(), -decimals); // {rTok}

        // {qRTok} = {BU} * {rTok} / {BU} * {qRTok/rTok}
        return held.mulDiv(totalSupply, needed).shiftl_toUint(decimals);
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
    function stRSRExchangeRate() external returns (int192) {
        main.poke();
        return main.stRSR().exchangeRate();
    }

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue() external returns (int192 total) {
        main.poke();
        IAssetRegistry reg = main.assetRegistry();
        address backingManager = address(main.backingManager());

        IERC20[] memory erc20s = reg.erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = reg.toAsset(erc20s[i]);
            // Exclude collateral that has defaulted
            if (
                asset.isCollateral() &&
                ICollateral(address(asset)).status() != CollateralStatus.DISABLED
            ) {
                total = total.plus(asset.bal(backingManager).mul(asset.price()));
            }
        }
    }

    /// @return deposits The deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(uint256 amount) external returns (uint256[] memory deposits) {
        main.poke();
        IRToken rTok = main.rToken();
        IBasketHandler bh = main.basketHandler();

        // Compute # of baskets to create `amount` qRTok
        int192 baskets = (rTok.totalSupply() > 0) // {BU}
            ? rTok.basketsNeeded().muluDivu(amount, rTok.totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(rTok.decimals())); // {qRTok / qRTok}

        (, deposits) = bh.quote(baskets, CEIL);
    }

    /// @return tokens The addresses of the ERC20s backing the RToken
    /// @custom:view
    function basketTokens() external view returns (address[] memory tokens) {
        (tokens, ) = main.basketHandler().quote(FIX_ONE, CEIL);
    }
}
