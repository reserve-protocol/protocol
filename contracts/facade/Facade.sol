// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/RToken.sol";
import "contracts/p1/StRSRVotes.sol";

/**
 * @title Facade
 * @notice A UX-friendly layer for non-governance protocol interactions
 * @custom:static-call - Use ethers callStatic() in order to get result after update
 */
contract Facade is IFacade {
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
        main.backingManager().claimAndSweepRewards();
        main.rsrTrader().claimAndSweepRewards();
        main.rTokenTrader().claimAndSweepRewards();
        rToken.claimAndSweepRewards();
    }

    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256) {
        IMain main = rToken.main();
        main.poke();
        // {BU}

        uint192 held = main.basketHandler().basketsHeldBy(account);
        uint192 needed = rToken.basketsNeeded();

        int8 decimals = int8(rToken.decimals());

        // return {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
        if (needed.eq(FIX_ZERO)) return held.shiftl_toUint(decimals);

        uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

        // {qRTok} = {BU} * {rTok} / {BU} * {qRTok/rTok}
        return held.mulDiv(totalSupply, needed).shiftl_toUint(decimals);
    }

    /// @return tokens Array of all known ERC20 asset addreses.
    /// @return amounts {qTok} Array of balance that the protocol holds of this current asset
    /// @custom:static-call
    function currentAssets(IRToken rToken)
        external
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        IMain main = rToken.main();
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

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue(IRToken rToken) external returns (uint192 total) {
        IMain main = rToken.main();
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

    /// @custom:static-call
    function issue(IRToken rToken, uint256 amount)
        public
        returns (address[] memory tokens, uint256[] memory deposits)
    {
        IMain main = rToken.main();
        main.poke();
        IRToken rTok = rToken;
        IBasketHandler bh = main.basketHandler();

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (rTok.totalSupply() > 0) // {BU}
            ? rTok.basketsNeeded().muluDivu(amount, rTok.totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(rTok.decimals())); // {qRTok / qRTok}

        (tokens, deposits) = bh.quote(baskets, CEIL);
    }

    /// @return erc20s The ERC20 addresses in the current basket
    /// @return uoaShares {1} The proportion of the basket associated with each ERC20
    /// @custom:static-call
    function basketBreakdown(IRToken rToken)
        external
        returns (address[] memory erc20s, uint192[] memory uoaShares)
    {
        uint256[] memory deposits;
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();

        // ({ERC20}, {qTok})
        (erc20s, deposits) = issue(rToken, FIX_ONE);

        // Calculate uoaAmts
        uint192 uoaSum;
        uint192[] memory uoaAmts = new uint192[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));
            int8 decimals = int8(IERC20Metadata(erc20s[i]).decimals());

            // {UoA} = {qTok} * {tok/qTok} * {UoA/tok}
            uoaAmts[i] = shiftl_toFix(deposits[i], -decimals).mul(asset.price());
            uoaSum += uoaAmts[i];
        }

        uoaShares = new uint192[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uoaShares[i] = uoaAmts[i].div(uoaSum);
        }
    }

    /// @return tokens The addresses of the ERC20s backing the RToken
    function basketTokens(IRToken rToken) external view returns (address[] memory tokens) {
        IMain main = rToken.main();
        (tokens, ) = main.basketHandler().quote(FIX_ONE, CEIL);
    }

    /// @return stTokenAddress The address of the corresponding stToken for the rToken
    function stToken(IRToken rToken) external view returns (IStRSR stTokenAddress) {
        IMain main = rToken.main();
        stTokenAddress = main.stRSR();
    }

    /// @return backing The worst-case collaterazation % the protocol will have after done trading
    /// @return insurance The insurance value relative to the fully-backed value
    function backingOverview(IRToken rToken)
        external
        view
        returns (uint192 backing, uint192 insurance)
    {
        uint256 supply = rToken.totalSupply();
        if (supply == 0) return (0, 0);

        // {UoA} = {BU} * {UoA/BU}
        uint192 uoaNeeded = rToken.basketsNeeded().mul(rToken.main().basketHandler().price());

        // Useful abbreviations
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();
        address backingMgr = address(rToken.main().backingManager());
        IERC20 rsr = rToken.main().rsr();

        // Compute backing
        {
            IERC20[] memory erc20s = assetRegistry.erc20s();

            // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
            uint192 uoaHeld;
            for (uint256 i = 0; i < erc20s.length; i++) {
                if (erc20s[i] == rsr) continue;

                IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));

                // {UoA} = {tok} * {UoA/tok}
                uint192 uoa = asset.bal(backingMgr).mul(asset.price());
                uoaHeld = uoaHeld.plus(uoa);
            }

            // {1} = {UoA} / {UoA}
            backing = uoaHeld.div(uoaNeeded);
        }

        // Compute insurance
        {
            IAsset rsrAsset = assetRegistry.toAsset(rsr);

            // {tok} = {tok} + {tok}
            uint192 rsrBal = rsrAsset.bal(backingMgr).plus(
                rsrAsset.bal(address(rToken.main().stRSR()))
            );

            // {UoA} = {tok} * {UoA/tok}
            uint192 rsrUoA = rsrBal.mul(rsrAsset.price());

            // {1} = {UoA} / {UoA}
            insurance = rsrUoA.div(uoaNeeded);
        }
    }

    /// @return {UoA/tok} The price of the RToken as given by the relevant RTokenAsset
    function price(IRToken rToken) external view returns (uint192) {
        return rToken.main().assetRegistry().toAsset(IERC20(address(rToken))).price();
    }
}

/**
 * @title Facade
 * @notice An extension of the Facade specific to P1
 */
contract FacadeP1 is Facade, IFacadeP1 {
    // solhint-disable-next-line no-empty-blocks
    constructor() Facade() {}

    /// @param account The account for the query
    /// @return issuances All the pending RToken issuances for an account
    /// @custom:view
    function pendingIssuances(IRToken rToken, address account)
        external
        view
        returns (Pending[] memory issuances)
    {
        RTokenP1 rTok = RTokenP1(address(rToken));
        (, uint256 left, uint256 right) = rTok.issueQueues(account);
        issuances = new Pending[](right - left);
        for (uint256 i = 0; i < right - left; i++) {
            RTokenP1.IssueItem memory issueItem = rTok.issueItem(account, i + left);
            uint256 diff = i + left == 0
                ? issueItem.amtRToken
                : issueItem.amtRToken - rTok.issueItem(account, i + left - 1).amtRToken;
            issuances[i] = Pending(i + left, issueItem.when, diff);
        }
    }

    /// @param account The account for the query
    /// @return unstakings All the pending RToken issuances for an account
    /// @custom:view
    function pendingUnstakings(IRToken rToken, address account)
        external
        view
        returns (Pending[] memory unstakings)
    {
        StRSRP1Votes stRSR = StRSRP1Votes(address(rToken.main().stRSR()));
        uint256 era = stRSR.currentEra();
        uint256 left = stRSR.firstRemainingDraft(era, account);
        uint256 right = stRSR.draftQueueLen(era, account);

        unstakings = new Pending[](right - left);
        for (uint256 i = 0; i < right - left; i++) {
            (uint192 drafts, uint64 availableAt) = stRSR.draftQueues(era, account, i + left);

            uint192 diff = drafts;
            if (i + left > 0) {
                (uint192 prevDrafts, ) = stRSR.draftQueues(era, account, i + left - 1);
                diff = drafts - prevDrafts;
            }

            unstakings[i] = Pending(i + left, availableAt, diff);
        }
    }
}
