// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../plugins/trading/DutchTrade.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IRToken.sol";
import "../../interfaces/IStRSR.sol";
import "../../libraries/Fixed.sol";
import "../../p1/BasketHandler.sol";
import "../../p1/RToken.sol";
import "../../p1/StRSRVotes.sol";
import "./MaxIssuableFacet.sol";

/**
 * @title ReadFacet
 * @notice
 *   Facet for reading out the state of a ^3.0.0 RToken in summary views.
 *   Backwards-compatible with 2.1.0 RTokens with the exception of `redeemCustom()`.
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
// slither-disable-start
contract ReadFacet {
    using FixLib for uint192;

    // === Static Calls ===

    /// Do no use inifite approvals.  Instead, use BasketHandler.quote() to determine the amount
    ///     of backing tokens to approve.
    /// @return tokens The erc20 needed for the issuance
    /// @return deposits {qTok} The deposits necessary to issue `amount` RToken
    /// @return depositsUoA {UoA} The UoA value of the deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(IRToken rToken, uint256 amount)
        external
        returns (
            address[] memory tokens,
            uint256[] memory deposits,
            uint192[] memory depositsUoA
        )
    {
        IMain main = rToken.main();
        require(!main.frozen(), "frozen");

        // Cache components
        IRToken rTok = rToken;
        BasketHandlerP1 bh = BasketHandlerP1(address(main.basketHandler()));
        IAssetRegistry reg = main.assetRegistry();

        // Poke Main
        reg.refresh();

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (rTok.totalSupply() > 0) // {BU}
            ? rTok.basketsNeeded().muluDivu(amount, rTok.totalSupply()) // {BU * qRTok / qRTok}
            : _safeWrap(amount); // take advantage of RToken having 18 decimals

        (tokens, deposits) = bh.quote(baskets, CEIL);
        depositsUoA = new uint192[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IAsset asset = reg.toAsset(IERC20(tokens[i]));
            (uint192 low, uint192 high) = asset.price();
            // untestable:
            //      if high == FIX_MAX then low has to be zero, so this check will not be reached
            if (low == 0 || high == FIX_MAX) continue;

            uint192 mid = (low + high) / 2;

            // {UoA} = {tok} * {UoA/Tok}
            depositsUoA[i] = shiftl_toFix(deposits[i], -int8(asset.erc20Decimals()), CEIL).mul(mid);
        }
    }

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances the reedemer would receive after a full redemption
    /// @return available The amount actually available, for each token
    /// @dev If available[i] < withdrawals[i], then RToken.redeem() would revert
    /// @custom:static-call
    function redeem(IRToken rToken, uint256 amount)
        external
        returns (
            address[] memory tokens,
            uint256[] memory withdrawals,
            uint256[] memory available
        )
    {
        IMain main = rToken.main();
        require(!main.frozen(), "frozen");

        // Cache Components
        IRToken rTok = rToken;
        BasketHandlerP1 bh = BasketHandlerP1(address(main.basketHandler()));

        // Poke Main
        main.assetRegistry().refresh();

        uint256 supply = rTok.totalSupply();

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        uint192 basketsRedeemed = rTok.basketsNeeded().muluDivu(amount, supply);
        (tokens, withdrawals) = bh.quote(basketsRedeemed, FLOOR);
        available = new uint256[](tokens.length);

        // Calculate prorata amounts
        for (uint256 i = 0; i < tokens.length; i++) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            available[i] = mulDiv256(
                IERC20(tokens[i]).balanceOf(address(main.backingManager())),
                amount,
                supply
            ); // FLOOR
        }
    }

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances necessary to issue `amount` RToken
    /// @custom:static-call
    function redeemCustom(
        IRToken rToken,
        uint256 amount,
        uint48[] memory basketNonces,
        uint192[] memory portions
    ) external returns (address[] memory tokens, uint256[] memory withdrawals) {
        IMain main = rToken.main();
        require(!main.frozen(), "frozen");

        // Call collective state keepers.
        main.poke();

        uint256 supply = rToken.totalSupply();

        // === Get basket redemption amounts ===
        uint256 portionsSum;
        for (uint256 i = 0; i < portions.length; ++i) {
            portionsSum += portions[i];
        }
        require(portionsSum == FIX_ONE, "portions do not add up to FIX_ONE");

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        uint192 basketsRedeemed = rToken.basketsNeeded().muluDivu(amount, supply);
        (tokens, withdrawals) = main.basketHandler().quoteCustomRedemption(
            basketNonces,
            portions,
            basketsRedeemed
        );

        // ==== Prorate redemption ====
        // Bound each withdrawal by the prorata share, in case currently under-collateralized
        for (uint256 i = 0; i < tokens.length; i++) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            uint256 prorata = mulDiv256(
                IERC20(tokens[i]).balanceOf(address(main.backingManager())),
                amount,
                supply
            ); // FLOOR
            if (prorata < withdrawals[i]) withdrawals[i] = prorata;
        }
    }

    /// @return erc20s The ERC20 addresses in the current basket
    /// @return uoaShares {1} The proportion of the basket associated with each ERC20
    /// @return targets The bytes32 representations of the target unit associated with each ERC20
    /// @custom:static-call
    function basketBreakdown(IRToken rToken)
        external
        returns (
            address[] memory erc20s,
            uint192[] memory uoaShares,
            bytes32[] memory targets
        )
    {
        uint256[] memory deposits;
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();
        BasketHandlerP1 basketHandler = BasketHandlerP1(address(rToken.main().basketHandler()));

        // solhint-disable-next-line no-empty-blocks
        try rToken.main().furnace().melt() {} catch {} // <3.1.0 RTokens may revert while frozen

        (erc20s, deposits) = basketHandler.quote(FIX_ONE, CEIL);

        // Calculate uoaAmts
        uint192 uoaSum;
        uint192[] memory uoaAmts = new uint192[](erc20s.length);
        targets = new bytes32[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            ICollateral coll = assetRegistry.toColl(IERC20(erc20s[i]));
            targets[i] = coll.targetName();

            int8 decimals = int8(IERC20Metadata(erc20s[i]).decimals());
            (uint192 low, uint192 high) = coll.price();
            if (low == 0 || high == FIX_MAX) continue;

            uint192 avg = (low + high) / 2; // {UoA/tok}

            // {UoA} = {qTok} * {tok/qTok} * {UoA/tok}
            uoaAmts[i] = shiftl_toFix(deposits[i], -decimals, FLOOR).mul(avg);
            uoaSum += uoaAmts[i];
        }

        uoaShares = new uint192[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uoaShares[i] = uoaAmts[i].div(uoaSum);
        }
    }

    /// @return erc20s The registered ERC20s
    /// @return balances {qTok} The held balances of each ERC20 across all traders
    /// @return balancesNeededByBackingManager {qTok} does not account for backingBuffer
    /// @custom:static-call
    function balancesAcrossAllTraders(IRToken rToken)
        external
        returns (
            IERC20[] memory erc20s,
            uint256[] memory balances,
            uint256[] memory balancesNeededByBackingManager
        )
    {
        IMain main = rToken.main();
        main.assetRegistry().refresh();

        erc20s = main.assetRegistry().erc20s();
        balances = new uint256[](erc20s.length);
        balancesNeededByBackingManager = new uint256[](erc20s.length);

        uint192 basketsNeeded = rToken.basketsNeeded(); // {BU}

        for (uint256 i = 0; i < erc20s.length; ++i) {
            balances[i] = erc20s[i].balanceOf(address(main.backingManager()));
            balances[i] += erc20s[i].balanceOf(address(main.rTokenTrader()));
            balances[i] += erc20s[i].balanceOf(address(main.rsrTrader()));

            // {qTok} = {tok/BU} * {BU} * {tok} * {qTok/tok}
            uint192 balNeededFix = main.basketHandler().quantity(erc20s[i]).safeMul(
                basketsNeeded,
                RoundingMode.FLOOR // FLOOR to match redemption
            );

            balancesNeededByBackingManager[i] = balNeededFix.shiftl_toUint(
                int8(IERC20Metadata(address(erc20s[i])).decimals()),
                RoundingMode.FLOOR
            );
        }
    }

    // === Views ===

    struct Pending {
        uint256 index;
        uint256 availableAt;
        uint256 amount;
    }

    /// @param draftEra {draftEra} The draft era to query unstakings for
    /// @param account The account for the query
    /// @return unstakings {qRSR} All the pending StRSR unstakings for an account, in RSR
    function pendingUnstakings(
        RTokenP1 rToken,
        uint256 draftEra,
        address account
    ) external view returns (Pending[] memory unstakings) {
        StRSRP1 stRSR = StRSRP1(address(rToken.main().stRSR()));
        uint256 left = stRSR.firstRemainingDraft(draftEra, account);
        uint256 right = stRSR.draftQueueLen(draftEra, account);
        uint192 draftRate = stRSR.draftRate();

        unstakings = new Pending[](right - left);
        for (uint256 i = 0; i < right - left; i++) {
            (uint192 drafts, uint64 availableAt) = stRSR.draftQueues(draftEra, account, i + left);

            uint192 diff = drafts;
            if (i + left > 0) {
                (uint192 prevDrafts, ) = stRSR.draftQueues(draftEra, account, i + left - 1);
                diff = drafts - prevDrafts;
            }

            // {qRSR} = {qDrafts} / {qDrafts/qRSR}
            unstakings[i] = Pending(i + left, availableAt, diff.div(draftRate));
        }
    }

    /// Returns the prime basket
    /// @dev Indices are shared aross return values
    /// @return erc20s The erc20s in the prime basket
    /// @return targetNames The bytes32 name identifier of the target unit, per ERC20
    /// @return targetAmts {target/BU} The amount of the target unit in the basket, per ERC20
    function primeBasket(IRToken rToken)
        external
        view
        returns (
            IERC20[] memory erc20s,
            bytes32[] memory targetNames,
            uint192[] memory targetAmts
        )
    {
        return BasketHandlerP1(address(rToken.main().basketHandler())).getPrimeBasket();
    }

    /// @return tokens The ERC20s backing the RToken
    function basketTokens(IRToken rToken) external view returns (address[] memory tokens) {
        BasketHandlerP1 bh = BasketHandlerP1(address(rToken.main().basketHandler()));
        (tokens, ) = bh.quote(FIX_ONE, RoundingMode.FLOOR);
    }

    /// Returns the backup configuration for a given targetName
    /// @param targetName The name of the target unit to lookup the backup for
    /// @return erc20s The backup erc20s for the target unit, in order of most to least desirable
    /// @return max The maximum number of tokens from the array to use at a single time
    function backupConfig(IRToken rToken, bytes32 targetName)
        external
        view
        returns (IERC20[] memory erc20s, uint256 max)
    {
        return BasketHandlerP1(address(rToken.main().basketHandler())).getBackupConfig(targetName);
    }

    /// @return stTokenAddress The address of the corresponding stToken for the rToken
    function stToken(IRToken rToken) external view returns (IStRSR stTokenAddress) {
        IMain main = rToken.main();
        stTokenAddress = main.stRSR();
    }

    /// @return backing {1} The worstcase collateralization % the protocol will have after trading
    /// @return overCollateralization {1} The over-collateralization value relative to the
    ///     fully-backed value as a %
    function backingOverview(IRToken rToken)
        external
        view
        returns (uint192 backing, uint192 overCollateralization)
    {
        uint256 supply = rToken.totalSupply();
        if (supply == 0) return (0, 0);

        uint192 basketsNeeded = rToken.basketsNeeded(); // {BU}
        uint192 uoaNeeded; // {UoA}
        uint192 uoaHeldInBaskets; // {UoA}
        {
            BasketHandlerP1 bh = BasketHandlerP1(address(rToken.main().basketHandler()));
            (address[] memory basketERC20s, uint256[] memory quantities) = bh.quote(
                basketsNeeded,
                FLOOR
            );

            IAssetRegistry reg = rToken.main().assetRegistry();
            IBackingManager bm = rToken.main().backingManager();
            for (uint256 i = 0; i < basketERC20s.length; i++) {
                IAsset asset = reg.toAsset(IERC20(basketERC20s[i]));

                // {tok}
                uint192 needed = shiftl_toFix(quantities[i], -int8(asset.erc20Decimals()), CEIL);

                // {UoA/tok}
                (uint192 low, uint192 high) = asset.price();
                if (low == 0 || high == FIX_MAX) continue;
                uint192 avg = (low + high) / 2;

                // {UoA} = {UoA} + {tok}
                uoaNeeded += needed.mul(avg);

                // {UoA} = {UoA} + {tok} * {UoA/tok}
                uoaHeldInBaskets += fixMin(needed, asset.bal(address(bm))).mul(avg);
            }

            backing = uoaHeldInBaskets.div(uoaNeeded);
        }

        // Compute overCollateralization
        IAsset rsrAsset = rToken.main().assetRegistry().toAsset(rToken.main().rsr());

        // {tok} = {tok} + {tok}
        uint192 rsrBal = rsrAsset.bal(address(rToken.main().backingManager())).plus(
            rsrAsset.bal(address(rToken.main().stRSR()))
        );

        (uint192 lowPrice, uint192 highPrice) = rsrAsset.price();
        if (lowPrice > 0 && highPrice < FIX_MAX) {
            // {UoA} = {tok} * {UoA/tok}
            uint192 rsrUoA = rsrBal.mul((lowPrice + highPrice) / 2);

            // {1} = {UoA} / {UoA}
            overCollateralization = rsrUoA.div(uoaNeeded);
        }
    }

    /// @return low {UoA/tok} The low price of the RToken as given by the relevant RTokenAsset
    /// @return high {UoA/tok} The high price of the RToken as given by the relevant RTokenAsset
    function price(IRToken rToken) external view returns (uint192 low, uint192 high) {
        return rToken.main().assetRegistry().toAsset(IERC20(address(rToken))).price();
    }

    /// @return erc20s The list of ERC20s that have auctions that can be settled, for given trader
    function auctionsSettleable(ITrading trader) external view returns (IERC20[] memory erc20s) {
        IERC20[] memory allERC20s = trader.main().assetRegistry().erc20s();

        // Calculate which erc20s can have auctions settled
        uint256 num;
        IERC20[] memory unfiltered = new IERC20[](allERC20s.length); // will filter down later
        for (uint256 i = 0; i < allERC20s.length; ++i) {
            ITrade trade = trader.trades(allERC20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                unfiltered[num] = allERC20s[i];
                ++num;
            }
        }

        // Filter down
        erc20s = new IERC20[](num);
        for (uint256 i = 0; i < num; ++i) {
            erc20s[i] = unfiltered[i];
        }
    }
}
// slither-disable-end
