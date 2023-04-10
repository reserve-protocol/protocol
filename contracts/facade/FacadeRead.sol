// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IFacadeRead.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IStRSR.sol";
import "../libraries/Fixed.sol";
import "../p1/BasketHandler.sol";
import "../p1/BackingManager.sol";
import "../p1/Furnace.sol";
import "../p1/RToken.sol";
import "../p1/RevenueTrader.sol";
import "../p1/StRSRVotes.sol";

/**
 * @title Facade
 * @notice A UX-friendly layer for reading out the state of an RToken in summary views.
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
contract FacadeRead is IFacadeRead {
    using FixLib for uint192;

    // === Static Calls ===

    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256) {
        IMain main = rToken.main();
        main.poke();
        // {BU}

        BasketRange memory basketsHeld = main.basketHandler().basketsHeldBy(account);
        uint192 needed = rToken.basketsNeeded();

        int8 decimals = int8(rToken.decimals());

        // return {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
        if (needed.eq(FIX_ZERO)) return basketsHeld.bottom.shiftl_toUint(decimals);

        uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

        // {qRTok} = {BU} * {rTok} / {BU} * {qRTok/rTok}
        return basketsHeld.bottom.mulDiv(totalSupply, needed).shiftl_toUint(decimals);
    }

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
        main.poke();
        IRToken rTok = rToken;
        IBasketHandler bh = main.basketHandler();
        IAssetRegistry reg = main.assetRegistry();

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (rTok.totalSupply() > 0) // {BU}
            ? rTok.basketsNeeded().muluDivu(amount, rTok.totalSupply()) // {BU * qRTok / qRTok}
            : _safeWrap(amount); // take advantage of RToken having 18 decimals

        (tokens, deposits) = bh.quote(baskets, CEIL);
        depositsUoA = new uint192[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IAsset asset = reg.toAsset(IERC20(tokens[i]));
            (uint192 low, uint192 high) = asset.price();
            if (low == 0 || high == FIX_MAX) continue;

            uint192 mid = (low + high) / 2;

            // {UoA} = {tok} * {UoA/Tok}
            depositsUoA[i] = shiftl_toFix(deposits[i], -int8(asset.erc20Decimals())).mul(mid);
        }
    }

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances necessary to issue `amount` RToken
    /// @return isProrata True if the redemption is prorata and not full
    /// @custom:static-call
    function redeem(
        IRToken rToken,
        uint256 amount,
        uint48 basketNonce
    )
        external
        returns (
            address[] memory tokens,
            uint256[] memory withdrawals,
            bool isProrata
        )
    {
        IMain main = rToken.main();
        main.poke();
        IRToken rTok = rToken;
        IBasketHandler bh = main.basketHandler();
        uint256 supply = rTok.totalSupply();
        require(bh.nonce() == basketNonce, "non-current basket nonce");

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        uint192 basketsRedeemed = rTok.basketsNeeded().muluDivu(amount, supply);

        (tokens, withdrawals) = bh.quote(basketsRedeemed, FLOOR);

        // Bound each withdrawal by the prorata share, in case we're currently under-collateralized
        address backingManager = address(main.backingManager());
        for (uint256 i = 0; i < tokens.length; ++i) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            uint256 prorata = mulDiv256(
                IERC20Upgradeable(tokens[i]).balanceOf(backingManager),
                amount,
                supply
            ); // FLOOR

            if (prorata < withdrawals[i]) {
                withdrawals[i] = prorata;
                isProrata = true;
            }
        }
    }

    /// @return erc20s The ERC20 addresses in the current basket
    /// @return uoaShares {1} The proportion of the basket associated with each ERC20
    /// @return targets The bytes32 representations of the target unit associated with each ERC20
    /// @custom:static-call
    function basketBreakdown(RTokenP1 rToken)
        external
        returns (
            address[] memory erc20s,
            uint192[] memory uoaShares,
            bytes32[] memory targets
        )
    {
        uint256[] memory deposits;
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();
        IBasketHandler basketHandler = rToken.main().basketHandler();

        // (erc20s, deposits) = issue(rToken, FIX_ONE);

        // solhint-disable-next-line no-empty-blocks
        try rToken.main().furnace().melt() {} catch {}

        (erc20s, deposits) = basketHandler.quote(FIX_ONE, CEIL);

        // Calculate uoaAmts
        uint192 uoaSum;
        uint192[] memory uoaAmts = new uint192[](erc20s.length);
        targets = new bytes32[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            ICollateral coll = assetRegistry.toColl(IERC20(erc20s[i]));
            int8 decimals = int8(IERC20Metadata(erc20s[i]).decimals());
            (uint192 lowPrice, ) = coll.price();

            // {UoA} = {qTok} * {tok/qTok} * {UoA/tok}
            uoaAmts[i] = shiftl_toFix(deposits[i], -decimals).mul(lowPrice);
            uoaSum += uoaAmts[i];
            targets[i] = coll.targetName();
        }

        uoaShares = new uint192[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uoaShares[i] = uoaAmts[i].div(uoaSum);
        }
    }

    // === Views ===

    /// @param account The account for the query
    /// @return unstakings All the pending StRSR unstakings for an account
    /// @custom:view
    function pendingUnstakings(RTokenP1 rToken, address account)
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

    /// Returns the prime basket
    /// @dev Indices are shared aross return values
    /// @return erc20s The erc20s in the prime basket
    /// @return targetNames The bytes32 name identifier of the target unit, per ERC20
    /// @return targetAmts {target/BU} The amount of the target unit in the basket, per ERC20
    function primeBasket(RTokenP1 rToken)
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
        (tokens, ) = rToken.main().basketHandler().quote(FIX_ONE, RoundingMode.FLOOR);
    }

    /// Returns the backup configuration for a given targetName
    /// @param targetName The name of the target unit to lookup the backup for
    /// @return erc20s The backup erc20s for the target unit, in order of most to least desirable
    /// @return max The maximum number of tokens from the array to use at a single time
    function backupConfig(RTokenP1 rToken, bytes32 targetName)
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

        // {BU}
        uint192 basketsNeeded = rToken.basketsNeeded();

        // {BU}
        BasketRange memory buRange = basketRange(rToken, basketsNeeded);

        // {1} = {UoA} / {UoA}
        backing = buRange.bottom.div(basketsNeeded);

        // Compute overCollateralization
        IAsset rsrAsset = rToken.main().assetRegistry().toAsset(rToken.main().rsr());

        // {tok} = {tok} + {tok}
        uint192 rsrBal = rsrAsset.bal(address(rToken.main().backingManager())).plus(
            rsrAsset.bal(address(rToken.main().stRSR()))
        );

        (uint192 lowPrice, ) = rsrAsset.price();

        // {UoA} = {tok} * {UoA/tok}
        uint192 rsrUoA = rsrBal.mul(lowPrice);

        // {UoA/BU}
        (uint192 buPriceLow, ) = rToken.main().basketHandler().price();

        // {UoA} = {BU} * {UoA/BU}
        uint192 uoaNeeded = basketsNeeded.mul(buPriceLow);

        // {1} = {UoA} / {UoA}
        overCollateralization = rsrUoA.div(uoaNeeded);
    }

    /// @return erc20s The registered ERC20s
    /// @return balances {qTok} The held balances of each ERC20 at the trader
    /// @return balancesNeeded {qTok} The needed balance of each ERC20 at the trader
    function traderBalances(IRToken rToken, ITrading trader)
        external
        view
        returns (
            IERC20[] memory erc20s,
            uint256[] memory balances,
            uint256[] memory balancesNeeded
        )
    {
        IBackingManager backingManager = rToken.main().backingManager();
        IBasketHandler basketHandler = rToken.main().basketHandler();

        erc20s = rToken.main().assetRegistry().erc20s();
        balances = new uint256[](erc20s.length);
        balancesNeeded = new uint256[](erc20s.length);

        uint192 backingBuffer = TestIBackingManager(address(backingManager)).backingBuffer();
        uint192 basketsNeeded = rToken.basketsNeeded().mul(FIX_ONE.plus(backingBuffer)); // {BU}

        bool isBackingManager = trader == backingManager;
        for (uint256 i = 0; i < erc20s.length; ++i) {
            balances[i] = erc20s[i].balanceOf(address(trader));

            if (isBackingManager) {
                // {qTok} = {tok/BU} * {BU} * {tok} * {qTok/tok}
                uint192 balNeededFix = basketHandler.quantity(erc20s[i]).safeMul(
                    basketsNeeded,
                    RoundingMode.FLOOR // FLOOR to match redemption
                );

                balancesNeeded[i] = balNeededFix.shiftl_toUint(
                    int8(IERC20Metadata(address(erc20s[i])).decimals()),
                    RoundingMode.FLOOR
                );
            }
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

    // === Private ===

    function basketRange(IRToken rToken, uint192 basketsNeeded)
        private
        view
        returns (BasketRange memory range)
    {
        IMain main = rToken.main();
        IBasketHandler bh = main.basketHandler();
        IBackingManager bm = main.backingManager();
        BasketRange memory basketsHeld = bh.basketsHeldBy(address(bm));

        // if (bh.fullyCollateralized())
        if (basketsHeld.bottom >= basketsNeeded) {
            range.bottom = basketsNeeded;
            range.top = basketsNeeded;
        } else {
            // Note: Extremely this is extremely wasteful in terms of gas. This only exists so
            // there is _some_ asset to represent the RToken itself when it is deployed, in
            // the absence of an external price feed. Any RToken that gets reasonably big
            // should switch over to an asset with a price feed.

            TradingContext memory ctx = TradingContext({
                basketsHeld: basketsHeld,
                bm: bm,
                bh: bh,
                reg: main.assetRegistry(),
                stRSR: main.stRSR(),
                rsr: main.rsr(),
                rToken: main.rToken(),
                minTradeVolume: bm.minTradeVolume(),
                maxTradeSlippage: bm.maxTradeSlippage()
            });

            Registry memory reg = ctx.reg.getRegistry();

            // will exclude UoA value from RToken balances at BackingManager
            range = RecollateralizationLibP1.basketRange(ctx, reg);
        }
    }
}
