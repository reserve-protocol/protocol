# MEV

This document is intended to serve as a resource for MEV searchers and others looking to interact with the deployed protocol programatically.

## Overview

Like any protocol, the Reserve Protocol causes some amount of MEV. While the full extent is not necessarily described here, there are two obvious examples of MEV opportunities in the protocol:

1. Issuance/Redemption
2. Auctions

### 1. Issuance/Redemption

MEV searchers can arb an RToken's issuance/redemption price against the broader market, whether that be AMM pools or CEX prices. This is a fairly standard MEV opportunity and it works the way an MEV searcher would expect. All that one needs to be able to do to participate is execute `issue()` or `redeem()` on the `RToken.sol` contract. The issuance requires approvals in advance, while the `redeem()` does not. You can find more documentation elsewhere in the repo about the properties of our `issue()`/`redeem()`/`redeemCustom()` functions. In short, they are atomic and work the way a searcher would expect, with the caveat that `redeem()` will revert during rebalancing (`redeemCustom()` does not).

### 2. Auctions

To bid in the protocol's single-lot, atomic, falling-price dutch auctions, an MEV searcher needs to monitor all `Broker` instances associated with RTokens. Whenever a `Broker` emits a `TradeStarted(ITrade indexed trade, IERC20 indexed sell, IERC20 indexed buy, uint256 sellAmount, uint256 minBuyAmount)` event, the `trade.KIND()` can be checked to see what kind of trade it is.

- if trade.KIND() == 0, then it is a [DutchTrade](../contracts/plugins/trading/DutchTrade.sol)
- if trade.KIND() == 1, then it is a [GnosisTrade](../contracts/plugins/trading/GnosisTrade.sol)

#### DutchTrade

Bidding instructions from the `DutchTrade` contract:

`DutchTrade` (relevant) interface:

```solidity
function bid() external; // execute a bid at the current block number

function sell() external view returns (IERC20);

function buy() external view returns (IERC20);

function status() external view returns (uint8); // 0: not_started, 1: active, 2: closed, 3: mid-tx only

function lot() external view returns (uint256); // {qSellTok} the number of tokens being sold

function bidAmount(uint256 blockNumber) external view returns (uint256); // {qBuyTok} the number of tokens required to buy the lot, at a particular block number

```

To participate:

1. Call `status()` view; the auction is ongoing if return value is 1
2. Call `lot()` to see the number of tokens being sold
3. Call `bidAmount()` to see the number of tokens required to buy the lot, at various block numbers
4. After finding an attractive bidAmount, provide an approval for the `buy()` token. The spender should be the `DutchTrade` contract.
   **Note**: it is very important to set tight approvals! Do not set more than the `bidAmount()` for the desired bidding block else reorgs present risk.
5. Wait until the desired block is reached (hopefully not in the first 40% of the auction)
6. Call `bid()`. If someone else completes the auction first, this will revert with the error message "bid already received". Approvals do not have to be revoked in the event that another MEV searcher wins the auction. (Though ideally the searcher includes the approval in the same tx they `bid()`)

##### Sample Price Curve

This price curve is for two assets with 1% oracleError, and with a 1% maxTradeSlippage, during a 30-minute auction. The token has 6 decimals and the "even price" occurs at 100,000,000. The phase changes between different portions of the auction are shown with `============` dividers.

```
BigNumber { value: "102020210210" }
BigNumber { value: "82140223099" }
BigNumber { value: "66134114376" }
BigNumber { value: "53247007608" }
BigNumber { value: "42871124018" }
BigNumber { value: "34517153077" }
BigNumber { value: "27791029333" }
BigNumber { value: "22375579749" }
BigNumber { value: "18015402132" }
BigNumber { value: "14504862785" }
BigNumber { value: "11678398454" }
BigNumber { value: "9402708076" }
BigNumber { value: "7570466062" }
BigNumber { value: "6095260636" }
BigNumber { value: "4907518495" }
BigNumber { value: "3951227569" }
BigNumber { value: "3181278625" }
BigNumber { value: "2561364414" }
BigNumber { value: "2062248686" }
BigNumber { value: "1660392258" }
BigNumber { value: "1336842869" }
BigNumber { value: "1076341357" }
BigNumber { value: "866602010" }
BigNumber { value: "697733148" }
BigNumber { value: "561770617" }
BigNumber { value: "452302636" }
BigNumber { value: "364165486" }
BigNumber { value: "293203025" }
BigNumber { value: "236068538" }
BigNumber { value: "190067462" }
BigNumber { value: "153030304" }
============
BigNumber { value: "151670034" }
BigNumber { value: "150309765" }
BigNumber { value: "148949495" }
BigNumber { value: "147589226" }
BigNumber { value: "146228957" }
BigNumber { value: "144868687" }
BigNumber { value: "143508418" }
BigNumber { value: "142148149" }
BigNumber { value: "140787879" }
BigNumber { value: "139427610" }
BigNumber { value: "138067341" }
BigNumber { value: "136707071" }
BigNumber { value: "135346802" }
BigNumber { value: "133986532" }
BigNumber { value: "132626263" }
BigNumber { value: "131265994" }
BigNumber { value: "129905724" }
BigNumber { value: "128545455" }
BigNumber { value: "127185186" }
BigNumber { value: "125824916" }
BigNumber { value: "124464647" }
BigNumber { value: "123104378" }
BigNumber { value: "121744108" }
BigNumber { value: "120383839" }
BigNumber { value: "119023570" }
BigNumber { value: "117663300" }
BigNumber { value: "116303031" }
BigNumber { value: "114942761" }
BigNumber { value: "113582492" }
BigNumber { value: "112222223" }
BigNumber { value: "110861953" }
BigNumber { value: "109501684" }
BigNumber { value: "108141415" }
BigNumber { value: "106781145" }
BigNumber { value: "105420876" }
BigNumber { value: "104060607" }
BigNumber { value: "102700337" }
============
BigNumber { value: "101986999" }
BigNumber { value: "101920591" }
BigNumber { value: "101854183" }
BigNumber { value: "101787775" }
BigNumber { value: "101721367" }
BigNumber { value: "101654959" }
BigNumber { value: "101588551" }
BigNumber { value: "101522143" }
BigNumber { value: "101455735" }
BigNumber { value: "101389327" }
BigNumber { value: "101322919" }
BigNumber { value: "101256511" }
BigNumber { value: "101190103" }
BigNumber { value: "101123695" }
BigNumber { value: "101057287" }
BigNumber { value: "100990879" }
BigNumber { value: "100924471" }
BigNumber { value: "100858063" }
BigNumber { value: "100791655" }
BigNumber { value: "100725247" }
BigNumber { value: "100658839" }
BigNumber { value: "100592431" }
BigNumber { value: "100526023" }
BigNumber { value: "100459615" }
BigNumber { value: "100393207" }
BigNumber { value: "100326799" }
BigNumber { value: "100260391" }
BigNumber { value: "100193983" }
BigNumber { value: "100127575" }
BigNumber { value: "100061167" }
BigNumber { value: "99994759" }
BigNumber { value: "99928351" }
BigNumber { value: "99861943" }
BigNumber { value: "99795535" }
BigNumber { value: "99729127" }
BigNumber { value: "99662719" }
BigNumber { value: "99596311" }
BigNumber { value: "99529903" }
BigNumber { value: "99463496" }
BigNumber { value: "99397088" }
BigNumber { value: "99330680" }
BigNumber { value: "99264272" }
BigNumber { value: "99197864" }
BigNumber { value: "99131456" }
BigNumber { value: "99065048" }
BigNumber { value: "98998640" }
BigNumber { value: "98932232" }
BigNumber { value: "98865824" }
BigNumber { value: "98799416" }
BigNumber { value: "98733008" }
BigNumber { value: "98666600" }
BigNumber { value: "98600192" }
BigNumber { value: "98533784" }
BigNumber { value: "98467376" }
BigNumber { value: "98400968" }
BigNumber { value: "98334560" }
BigNumber { value: "98268152" }
BigNumber { value: "98201744" }
BigNumber { value: "98135336" }
BigNumber { value: "98068928" }
BigNumber { value: "98002520" }
BigNumber { value: "97936112" }
BigNumber { value: "97869704" }
BigNumber { value: "97803296" }
BigNumber { value: "97736888" }
BigNumber { value: "97670480" }
BigNumber { value: "97604072" }
BigNumber { value: "97537664" }
BigNumber { value: "97471256" }
BigNumber { value: "97404848" }
BigNumber { value: "97338440" }
BigNumber { value: "97272032" }
BigNumber { value: "97205624" }
BigNumber { value: "97139216" }
BigNumber { value: "97072808" }
============
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
```

#### GnosisTrade

`GnosisTrade.sol` implements a batch auction on top of Gnosis's [EasyAuction](https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol) platform. In general a batch auction is designed to minimize MEV, and indeed that's why it was chosen in the first place. Both types of auctions (batch + dutch) can be opened at anytime, but the expectation is that dutch auctions will be preferred by MEV searchers because they are more likely to be profitable.

However, if a batch auction is launched, an MEV searcher may still be able to profit. In order to bid in the auction, the searcher must call `function placeSellOrders(uint256 auctionId, uint96[] memory _minBuyAmounts, uint96[] memory _sellAmounts, bytes32[] memory _prevSellOrders, bytes calldata allowListCallData)`, providing an approval in advance. This call will escrow `_sellAmounts` tokens in EasyAuction for the remaining duration of the auction. Once the auction is over, anyone can settle the auction directly in EasyAuction via `settleAuction(uint256 auctionId)`, or by calling `settleTrade(IERC20 erc20)` on the `ITrading` instance in our system that started the trade (either BackingManager or a RevenueTrader).

Since the opportunity is not atomic, it is not likely MEV searchers will be very interested in this option. Still, there may be batch auctions that clear with money left on the table, so it is worth mentioning.

**Note**: Atomic settlement will always be set to disabled in EasyAuction, which makes the MEV opportunity further unattractive.
