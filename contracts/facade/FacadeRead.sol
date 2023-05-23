// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../plugins/trading/DutchTrade.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IFacadeRead.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IStRSR.sol";
import "../libraries/Fixed.sol";
import "../p1/BasketHandler.sol";
import "../p1/RToken.sol";
import "../p1/StRSRVotes.sol";

/**
 * @title Facade
 * @notice A UX-friendly layer for reading out the state of a ^3.0.0 RToken in summary views.
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
    function redeem(IRToken rToken, uint256 amount)
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
        main.furnace().melt();

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

    /// To use this, call via callStatic.
    /// If canStart is true, call backingManager.rebalance(). May require settling a
    /// trade first; see auctionsSettleable.
    /// @return canStart true iff a recollateralization auction can be started
    /// @return sell The sell token in the auction
    /// @return buy The buy token in the auction
    /// @return sellAmount {qSellTok} How much would be sold
    /// @custom:static-call
    function nextRecollateralizationAuction(IBackingManager bm)
        external
        returns (
            bool canStart,
            IERC20 sell,
            IERC20 buy,
            uint256 sellAmount
        )
    {
        IERC20[] memory erc20s = bm.main().assetRegistry().erc20s();

        // Settle any settle-able open trades
        if (bm.tradesOpen() > 0) {
            for (uint256 i = 0; i < erc20s.length; ++i) {
                ITrade trade = bm.trades(erc20s[i]);
                if (address(trade) != address(0) && trade.canSettle()) {
                    bm.settleTrade(erc20s[i]);
                    break; // backingManager can only have 1 trade open at a time
                }
            }
        }

        // If no auctions ongoing, try to find a new auction to start
        if (bm.tradesOpen() == 0) {
            bytes1 majorVersion = bytes(bm.version())[0];

            if (majorVersion == MAJOR_VERSION_3) {
                // solhint-disable-next-line no-empty-blocks
                try bm.rebalance(TradeKind.DUTCH_AUCTION) {} catch {}
            } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                IERC20[] memory emptyERC20s = new IERC20[](0);
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, ) = address(bm).call{ value: 0 }(
                    abi.encodeWithSignature("manageTokens(address[])", emptyERC20s)
                );
                success = success; // hush warning
            } else {
                revert("unrecognized version");
            }

            // Find the started auction
            for (uint256 i = 0; i < erc20s.length; ++i) {
                DutchTrade trade = DutchTrade(address(bm.trades(erc20s[i])));
                if (address(trade) != address(0)) {
                    canStart = true;
                    sell = trade.sell();
                    buy = trade.buy();
                    sellAmount = trade.sellAmount();
                }
            }
        }
    }

    /// To use this, call via callStatic.
    /// @return erc20s The ERC20s that have auctions that can be started
    /// @return canStart If the ERC20 auction can be started
    /// @return surpluses {qTok} The surplus amount
    /// @return minTradeAmounts {qTok} The minimum amount worth trading
    /// @custom:static-call
    function revenueOverview(IRevenueTrader revenueTrader)
        external
        returns (
            IERC20[] memory erc20s,
            bool[] memory canStart,
            uint256[] memory surpluses,
            uint256[] memory minTradeAmounts
        )
    {
        uint192 minTradeVolume = revenueTrader.minTradeVolume(); // {UoA}
        Registry memory reg = revenueTrader.main().assetRegistry().getRegistry();

        // Forward ALL revenue
        {
            IBackingManager bm = revenueTrader.main().backingManager();
            bytes1 majorVersion = bytes(bm.version())[0];

            if (majorVersion == MAJOR_VERSION_3) {
                // solhint-disable-next-line no-empty-blocks
                try bm.forwardRevenue(reg.erc20s) {} catch {}
            } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, ) = address(bm).call{ value: 0 }(
                    abi.encodeWithSignature("manageTokens(address[])", reg.erc20s)
                );
                success = success; // hush warning
            } else {
                revert("unrecognized version");
            }
        }

        erc20s = new IERC20[](reg.erc20s.length);
        canStart = new bool[](reg.erc20s.length);
        surpluses = new uint256[](reg.erc20s.length);
        minTradeAmounts = new uint256[](reg.erc20s.length);
        // Calculate which erc20s can have auctions started
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            // Settle first if possible. Required so we can assess full available balance
            ITrade trade = revenueTrader.trades(reg.erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                revenueTrader.settleTrade(reg.erc20s[i]);
            }

            uint48 tradesOpen = revenueTrader.tradesOpen();
            erc20s[i] = reg.erc20s[i];
            surpluses[i] = reg.erc20s[i].balanceOf(address(revenueTrader));

            (uint192 lotLow, ) = reg.assets[i].lotPrice(); // {UoA/tok}
            if (lotLow == 0) continue;

            // {qTok} = {UoA} / {UoA/tok}
            minTradeAmounts[i] = minTradeVolume.div(lotLow).shiftl_toUint(
                int8(reg.assets[i].erc20Decimals())
            );

            bytes1 majorVersion = bytes(revenueTrader.version())[0];
            if (
                reg.erc20s[i].balanceOf(address(revenueTrader)) > minTradeAmounts[i] &&
                revenueTrader.trades(reg.erc20s[i]) == ITrade(address(0))
            ) {
                if (majorVersion == MAJOR_VERSION_3) {
                    // solhint-disable-next-line no-empty-blocks
                    try revenueTrader.manageToken(erc20s[i], TradeKind.DUTCH_AUCTION) {} catch {}
                } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                    // solhint-disable-next-line avoid-low-level-calls
                    (bool success, ) = address(revenueTrader).call{ value: 0 }(
                        abi.encodeWithSignature("manageToken(address)", erc20s[i])
                    );
                    success = success; // hush warning
                } else {
                    revert("unrecognized version");
                }

                if (revenueTrader.tradesOpen() - tradesOpen > 0) {
                    canStart[i] = true;
                }
            }
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
        (tokens, ) = rToken.main().basketHandler().quote(FIX_ONE, RoundingMode.FLOOR);
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
            (address[] memory basketERC20s, uint256[] memory quantities) = rToken
                .main()
                .basketHandler()
                .quote(basketsNeeded, FLOOR);

            IAssetRegistry reg = rToken.main().assetRegistry();
            IBackingManager bm = rToken.main().backingManager();
            for (uint256 i = 0; i < basketERC20s.length; i++) {
                IAsset asset = reg.toAsset(IERC20(basketERC20s[i]));

                // {UoA/tok}
                (uint192 low, ) = asset.price();

                // {tok}
                uint192 needed = shiftl_toFix(quantities[i], -int8(asset.erc20Decimals()));

                // {UoA} = {UoA} + {tok}
                uoaNeeded += needed.mul(low);

                // {UoA} = {UoA} + {tok} * {UoA/tok}
                uoaHeldInBaskets += fixMin(needed, asset.bal(address(bm))).mul(low);
            }

            backing = uoaHeldInBaskets.div(uoaNeeded);
        }

        // Compute overCollateralization
        IAsset rsrAsset = rToken.main().assetRegistry().toAsset(rToken.main().rsr());

        // {tok} = {tok} + {tok}
        uint192 rsrBal = rsrAsset.bal(address(rToken.main().backingManager())).plus(
            rsrAsset.bal(address(rToken.main().stRSR()))
        );

        (uint192 lowPrice, ) = rsrAsset.price();

        // {UoA} = {tok} * {UoA/tok}
        uint192 rsrUoA = rsrBal.mul(lowPrice);

        // {1} = {UoA} / {UoA}
        overCollateralization = rsrUoA.div(uoaNeeded);
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
