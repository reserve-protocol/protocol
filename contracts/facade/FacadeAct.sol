// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IFacadeAct.sol";
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
 * @notice A UX-friendly layer for non-governance protocol interactions
 * @custom:static-call - Use ethers callStatic() in order to get result after update
 */
contract FacadeAct is IFacadeAct {
    using FixLib for uint192;

    struct Cache {
        IAssetRegistry reg;
        BackingManagerP1 bm;
        BasketHandlerP1 bh;
        RevenueTraderP1 rTokenTrader;
        RevenueTraderP1 rsrTrader;
        StRSRP1 stRSR;
        RTokenP1 rToken;
        IERC20 rsr;
    }

    /// Returns the next call a keeper of MEV searcher should make in order to progress the system
    /// Returns zero bytes to indicate no action should be made
    /// @dev This function begins reverting due to blocksize constraints at ~400 registered assets
    /// @custom:static-call
    function getActCalldata(RTokenP1 rToken) external returns (address, bytes memory) {
        // solhint-disable no-empty-blocks

        IMain main = rToken.main();
        Cache memory cache = Cache({
            reg: main.assetRegistry(),
            bm: BackingManagerP1(address(main.backingManager())),
            bh: BasketHandlerP1(address(main.basketHandler())),
            rTokenTrader: RevenueTraderP1(address(main.rTokenTrader())),
            rsrTrader: RevenueTraderP1(address(main.rsrTrader())),
            stRSR: StRSRP1(address(main.stRSR())),
            rsr: main.rsr(),
            rToken: rToken
        });
        IERC20[] memory erc20s = cache.reg.erc20s();

        // Refresh assets
        cache.reg.refresh();

        // tend to the basket and auctions
        {
            // first priority: keep the basket fresh
            if (cache.bh.status() == CollateralStatus.DISABLED) {
                cache.bh.refreshBasket();
                if (cache.bh.status() != CollateralStatus.DISABLED) {
                    // cache.bh.refreshBasket();
                    return (
                        address(cache.bh),
                        abi.encodeWithSelector(cache.bh.refreshBasket.selector)
                    );
                }
            }

            // see if backingManager settlement is required
            if (cache.bm.tradesOpen() > 0) {
                for (uint256 i = 0; i < erc20s.length; i++) {
                    ITrade trade = cache.bm.trades(erc20s[i]);
                    if (address(trade) != address(0) && trade.canSettle()) {
                        // try: cache.rTokenTrader.settleTrade(erc20s[i])

                        try cache.bm.settleTrade(erc20s[i]) {
                            // if succeeded
                            return (
                                address(cache.bm),
                                abi.encodeWithSelector(cache.bm.settleTrade.selector, erc20s[i])
                            );
                        } catch {}
                    }
                }
            } else if (
                cache.bh.status() == CollateralStatus.SOUND && !cache.bh.fullyCollateralized()
            ) {
                // try: backingManager.manageTokens([])

                IERC20[] memory empty = new IERC20[](0);
                try cache.bm.manageTokens(empty) {
                    return (
                        address(cache.bm),
                        abi.encodeWithSelector(cache.bm.manageTokens.selector, empty)
                    );
                } catch {}
            } else {
                // status() != SOUND || basketHandler.fullyCollateralized

                // check revenue traders
                for (uint256 i = 0; i < erc20s.length; i++) {
                    // rTokenTrader: if there's a trade to settle
                    ITrade trade = cache.rTokenTrader.trades(erc20s[i]);
                    if (address(trade) != address(0) && trade.canSettle()) {
                        // try: cache.rTokenTrader.settleTrade(erc20s[i])

                        try cache.rTokenTrader.settleTrade(erc20s[i]) {
                            return (
                                address(cache.rTokenTrader),
                                abi.encodeWithSelector(
                                    cache.rTokenTrader.settleTrade.selector,
                                    erc20s[i]
                                )
                            );
                        } catch {}
                    }

                    // rsrTrader: if there's a trade to settle
                    trade = cache.rsrTrader.trades(erc20s[i]);
                    if (address(trade) != address(0) && trade.canSettle()) {
                        // try: cache.rTokenTrader.settleTrade(erc20s[i])

                        try cache.rsrTrader.settleTrade(erc20s[i]) {
                            return (
                                address(cache.rsrTrader),
                                abi.encodeWithSelector(
                                    cache.rsrTrader.settleTrade.selector,
                                    erc20s[i]
                                )
                            );
                        } catch {}
                    }

                    // rTokenTrader: check if we can start any trades
                    uint48 tradesOpen = cache.rTokenTrader.tradesOpen();
                    try cache.rTokenTrader.manageToken(erc20s[i]) {
                        if (cache.rTokenTrader.tradesOpen() - tradesOpen > 0) {
                            // A trade started; do cache.rTokenTrader.manageToken
                            return (
                                address(cache.rTokenTrader),
                                abi.encodeWithSelector(
                                    cache.rTokenTrader.manageToken.selector,
                                    erc20s[i]
                                )
                            );
                        }
                    } catch {}

                    // rsrTrader: check if we can start any trades
                    tradesOpen = cache.rsrTrader.tradesOpen();
                    try cache.rsrTrader.manageToken(erc20s[i]) {
                        if (cache.rsrTrader.tradesOpen() - tradesOpen > 0) {
                            // A trade started; do cache.rsrTrader.manageToken
                            return (
                                address(cache.rsrTrader),
                                abi.encodeWithSelector(
                                    cache.rsrTrader.manageToken.selector,
                                    erc20s[i]
                                )
                            );
                        }
                    } catch {}
                }

                // maybe revenue needs to be forwarded from backingManager
                // only perform if basket is SOUND
                if (cache.bh.status() == CollateralStatus.SOUND) {
                    IAsset rsrAsset = cache.reg.toAsset(cache.rsr);
                    uint192 initialStRSRBal = rsrAsset.bal(address(cache.stRSR)); // {RSR}
                    try cache.bm.manageTokens(erc20s) {
                        // if this unblocked an auction in either revenue trader,
                        // then prepare backingManager.manageTokens
                        for (uint256 i = 0; i < erc20s.length; i++) {
                            address[] memory twoERC20s = new address[](2);

                            // rTokenTrader
                            {
                                if (address(erc20s[i]) != address(rToken)) {
                                    // rTokenTrader: check if we can start any trades
                                    uint48 tradesOpen = cache.rTokenTrader.tradesOpen();
                                    try cache.rTokenTrader.manageToken(erc20s[i]) {
                                        if (cache.rTokenTrader.tradesOpen() - tradesOpen > 0) {
                                            // always forward RToken + the ERC20
                                            twoERC20s[0] = address(rToken);
                                            twoERC20s[1] = address(erc20s[i]);
                                            // backingManager.manageTokens([rToken, erc20s[i])
                                            // forward revenue onward to the revenue traders
                                            return (
                                                address(cache.bm),
                                                abi.encodeWithSelector(
                                                    cache.bm.manageTokens.selector,
                                                    twoERC20s
                                                )
                                            );
                                        }
                                    } catch {}
                                }
                            }

                            // rsrTrader
                            {
                                if (erc20s[i] != cache.rsr) {
                                    // rsrTrader: check if we can start any trades
                                    uint48 tradesOpen = cache.rsrTrader.tradesOpen();
                                    try cache.rsrTrader.manageToken(erc20s[i]) {
                                        if (cache.rsrTrader.tradesOpen() - tradesOpen > 0) {
                                            // always forward RSR + the ERC20
                                            twoERC20s[0] = address(cache.rsr);
                                            twoERC20s[1] = address(erc20s[i]);
                                            // backingManager.manageTokens(rsr, erc20s[i])
                                            // forward revenue onward to the revenue traders
                                            return (
                                                address(cache.bm),
                                                abi.encodeWithSelector(
                                                    cache.bm.manageTokens.selector,
                                                    twoERC20s
                                                )
                                            );
                                        }
                                    } catch {}
                                }
                            }
                        }

                        // forward RToken in isolation only, if it's large enough
                        {
                            IAsset rTokenAsset = cache.reg.toAsset(IERC20(address(rToken)));
                            (uint192 lotLow, ) = rTokenAsset.lotPrice();

                            if (
                                rTokenAsset.bal(address(cache.rTokenTrader)) >
                                minTradeSize(cache.rTokenTrader.minTradeVolume(), lotLow)
                            ) {
                                try cache.rTokenTrader.manageToken(IERC20(address(rToken))) {
                                    address[] memory oneERC20 = new address[](1);
                                    oneERC20[0] = address(rToken);
                                    return (
                                        address(cache.bm),
                                        abi.encodeWithSelector(
                                            cache.bm.manageTokens.selector,
                                            oneERC20
                                        )
                                    );
                                } catch {}
                            }
                        }

                        // forward RSR in isolation only, if it's large enough
                        // via handoutExcessAssets
                        {
                            (uint192 lotLow, ) = rsrAsset.lotPrice();

                            if (
                                rsrAsset.bal(address(cache.stRSR)) - initialStRSRBal >
                                minTradeSize(cache.rsrTrader.minTradeVolume(), lotLow)
                            ) {
                                IERC20[] memory empty = new IERC20[](0);
                                return (
                                    address(cache.bm),
                                    abi.encodeWithSelector(cache.bm.manageTokens.selector, empty)
                                );
                            }
                        }
                    } catch {}
                }
            }
        }

        // check if there are reward tokens to claim
        {
            // save initial balances
            uint256[] memory initialBals = new uint256[](erc20s.length);
            for (uint256 i = 0; i < erc20s.length; ++i) {
                initialBals[i] = erc20s[i].balanceOf(address(cache.bm));
            }

            uint192 minTradeVolume = cache.bm.minTradeVolume(); // {UoA}

            // prefer restricting to backingManager.claimRewards when possible to save gas
            try cache.bm.claimRewards() {
                // See if any token bals grew sufficiently
                for (uint256 i = 0; i < erc20s.length; ++i) {
                    (uint192 lotLow, ) = cache.reg.toAsset(erc20s[i]).lotPrice(); // {tok}

                    uint256 bal = erc20s[i].balanceOf(address(cache.bm));
                    if (bal - initialBals[i] > minTradeSize(minTradeVolume, lotLow)) {
                        // It's large enough to trade! Return bm.claimRewards as next step.
                        return (
                            address(cache.bm),
                            abi.encodeWithSelector(cache.bm.claimRewards.selector, rToken)
                        );
                    }
                }
            } catch {}

            // save initial balances for both Revenue Traders
            uint256[] memory initialBalsRTokenTrader = new uint256[](erc20s.length);
            uint256[] memory initialBalsRSRTrader = new uint256[](erc20s.length);
            for (uint256 i = 0; i < erc20s.length; ++i) {
                initialBalsRTokenTrader[i] = erc20s[i].balanceOf(address(cache.rTokenTrader));
                initialBalsRSRTrader[i] = erc20s[i].balanceOf(address(cache.rsrTrader));
            }

            // look at rewards from all sources
            try this.claimRewards(rToken) {
                // See if any token bals grew sufficiently
                for (uint256 i = 0; i < erc20s.length; ++i) {
                    (uint192 lotLow, ) = cache.reg.toAsset(erc20s[i]).lotPrice(); // {tok}

                    // Get balances for revenue traders
                    uint256 balRTokenTrader = erc20s[i].balanceOf(address(cache.rTokenTrader));
                    uint256 balRSRTrader = erc20s[i].balanceOf(address(cache.rsrTrader));

                    // Check both traders
                    if (
                        (balRTokenTrader - initialBalsRTokenTrader[i]) >
                        minTradeSize(minTradeVolume, lotLow) ||
                        (balRSRTrader - initialBalsRSRTrader[i]) >
                        minTradeSize(minTradeVolume, lotLow)
                    ) {
                        // It's large enough to trade! Return claimRewards as next step.
                        return (
                            address(this),
                            abi.encodeWithSelector(this.claimRewards.selector, rToken)
                        );
                    }
                }
            } catch {}
        }

        return (address(0), new bytes(0));
    }

    function claimRewards(RTokenP1 rToken) public {
        IMain main = rToken.main();
        main.backingManager().claimRewards();
        main.rTokenTrader().claimRewards();
        main.rsrTrader().claimRewards();
    }

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(uint192 minTradeVolume, uint192 price) private pure returns (uint192) {
        // {tok} = {UoA} / {UoA/tok}
        uint192 size = price == 0 ? FIX_MAX : minTradeVolume.div(price, ROUND);
        return size > 0 ? size : 1;
    }
}
