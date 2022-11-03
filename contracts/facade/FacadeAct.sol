// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacadeAct.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/BasketHandler.sol";
import "contracts/p1/BackingManager.sol";
import "contracts/p1/Furnace.sol";
import "contracts/p1/RToken.sol";
import "contracts/p1/RevenueTrader.sol";
import "contracts/p1/StRSRVotes.sol";

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

        // tend to the basket and auctions
        {
            address[] memory empty = new address[](0);
            // first priority: keep the basket fresh
            if (cache.bh.status() == CollateralStatus.DISABLED) {
                cache.bh.refreshBasket();
                if (cache.bh.status() != CollateralStatus.DISABLED) {
                    // cache.bh.refreshBasket();
                    return (
                        address(cache.bh),
                        abi.encodeWithSelector(cache.bh.refreshBasket.selector, empty)
                    );
                }
            }

            // see if backingManager settlement is required
            if (cache.bm.tradesOpen() > 0) {
                for (uint256 i = 0; i < erc20s.length; i++) {
                    ITrade trade = cache.bm.trades(erc20s[i]);
                    if (address(trade) != address(0) && trade.canSettle()) {
                        // cache.bm.settleTrade(...)
                        return (
                            address(cache.bm),
                            abi.encodeWithSelector(cache.bm.settleTrade.selector, erc20s[i])
                        );
                    }
                }
            } else if (
                cache.bh.status() != CollateralStatus.DISABLED && !cache.bh.fullyCollateralized()
            ) {
                // backingManager.manageTokens([]);
                return (
                    address(cache.bm),
                    abi.encodeWithSelector(cache.bm.manageTokens.selector, empty)
                );
            } else {
                // collateralized

                RevenueTotals memory revTotals = main.distributor().totals();

                // check revenue traders
                for (uint256 i = 0; i < erc20s.length; i++) {
                    // rTokenTrader: if there's a trade to settle
                    ITrade trade = cache.rTokenTrader.trades(erc20s[i]);
                    if (address(trade) != address(0) && trade.canSettle()) {
                        // cache.rTokenTrader.settleTrade(...)
                        return (
                            address(cache.rTokenTrader),
                            abi.encodeWithSelector(
                                cache.rTokenTrader.settleTrade.selector,
                                erc20s[i]
                            )
                        );
                    }

                    // rsrTrader: if there's a trade to settle
                    trade = cache.rsrTrader.trades(erc20s[i]);
                    if (address(trade) != address(0) && trade.canSettle()) {
                        // cache.rsrTrader.settleTrade(...)
                        return (
                            address(cache.rsrTrader),
                            abi.encodeWithSelector(cache.rsrTrader.settleTrade.selector, erc20s[i])
                        );
                    }

                    // rTokenTrader: check if we can start any trades
                    if (revTotals.rTokenTotal > 0) {
                        uint48 tradesOpen = cache.rTokenTrader.tradesOpen();
                        cache.rTokenTrader.manageToken(erc20s[i]);
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
                    }

                    if (revTotals.rsrTotal > 0) {
                        // rsrTrader: check if we can start any trades
                        uint48 tradesOpen = cache.rsrTrader.tradesOpen();
                        cache.rsrTrader.manageToken(erc20s[i]);
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
                    }
                }

                // maybe revenue needs to be forwarded from backingManager
                // only perform if basket is not disabled
                if (cache.bh.status() != CollateralStatus.DISABLED) {
                    cache.bm.manageTokens(erc20s);

                    // if this unblocked an auction in either revenue trader,
                    // then prepare backingManager.manageTokens
                    for (uint256 i = 0; i < erc20s.length; i++) {
                        address[] memory twoERC20s = new address[](2);

                        // rTokenTrader
                        if (revTotals.rTokenTotal > 0 && address(erc20s[i]) != address(rToken)) {
                            // rTokenTrader: check if we can start any trades
                            uint48 tradesOpen = cache.rTokenTrader.tradesOpen();
                            cache.rTokenTrader.manageToken(erc20s[i]);
                            if (cache.rTokenTrader.tradesOpen() - tradesOpen > 0) {
                                // always manage RToken + one other ERC20
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
                        }

                        // rsrTrader
                        if (revTotals.rsrTotal > 0 && erc20s[i] != cache.rsr) {
                            // rsrTrader: check if we can start any trades
                            uint48 tradesOpen = cache.rsrTrader.tradesOpen();
                            cache.rsrTrader.manageToken(erc20s[i]);
                            if (cache.rsrTrader.tradesOpen() - tradesOpen > 0) {
                                // always manage RSR + one other ERC20
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
                        }
                    }
                }
            }
        }

        // check for a melting opportunity
        {
            FurnaceP1 furnace = FurnaceP1(address(main.furnace()));
            uint48 lastPayout = furnace.lastPayout();
            furnace.melt();
            if (furnace.lastPayout() != lastPayout) {
                // melt
                return (address(furnace), abi.encodeWithSelector(furnace.melt.selector));
            }
        }

        // check for a reward payout opportunity
        {
            uint48 payoutLastPaid = cache.stRSR.payoutLastPaid();
            cache.stRSR.payoutRewards();
            if (cache.stRSR.payoutLastPaid() != payoutLastPaid) {
                // payoutRewards
                return (
                    address(cache.stRSR),
                    abi.encodeWithSelector(cache.stRSR.payoutRewards.selector)
                );
            }
        }

        // check if there are reward tokens to claim
        {
            uint256 numRewardTokens;
            IERC20[] memory rewardTokens = new IERC20[](erc20s.length);
            uint256[] memory initialBals = new uint256[](erc20s.length);
            for (uint256 i = 0; i < erc20s.length; ++i) {
                // Does erc20s[i] _have_ a reward function and reward token?
                IAsset asset = cache.reg.toAsset(erc20s[i]);

                IERC20 rewardToken = asset.rewardERC20();
                if (address(rewardToken) == address(0) || !cache.reg.isRegistered(rewardToken)) {
                    continue;
                }

                (address _to, ) = asset.getClaimCalldata();
                if (_to == address(0)) continue;

                // Save rewardToken address, if new
                uint256 rtIndex = 0;
                while (rtIndex < numRewardTokens && rewardToken != rewardTokens[rtIndex]) rtIndex++;
                if (rtIndex >= numRewardTokens) {
                    rewardTokens[rtIndex] = rewardToken;
                    numRewardTokens++;
                }
            }

            for (uint256 i = 0; i < numRewardTokens; ++i) {
                initialBals[i] = rewardTokens[i].balanceOf(address(cache.bm));
            }

            claimAndSweepRewards(rToken);

            // See if reward token bals grew sufficiently
            for (uint256 i = 0; i < numRewardTokens; ++i) {
                uint192 minTradeVolume = cache.bm.minTradeVolume(); // {UoA}

                // {tok}
                uint192 price_ = cache.reg.toAsset(rewardTokens[i]).strictPrice();
                uint256 minTradeSize = type(uint256).max;
                if (price_ > 0)
                    minTradeSize = minTradeVolume.div(price_, ROUND).shiftl_toUint(
                        int8(IERC20Metadata(address(rewardTokens[i])).decimals())
                    );

                uint256 bal = rewardTokens[i].balanceOf(address(cache.bm));
                if (bal - initialBals[i] > minTradeSize) {
                    // It's large enough to trade! Return claimAndSweepRewards as next step.
                    return (
                        address(this),
                        abi.encodeWithSelector(this.claimAndSweepRewards.selector, rToken)
                    );
                }
            }
        }

        return (address(0), new bytes(0));
    }

    function claimAndSweepRewards(RTokenP1 rToken) public {
        IMain main = rToken.main();
        rToken.claimAndSweepRewards();
        main.backingManager().claimAndSweepRewards();
        main.rTokenTrader().claimAndSweepRewards();
        main.rsrTrader().claimAndSweepRewards();
    }
}
