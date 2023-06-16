# MEV

This document is intended to serve as a resource for MEV searchers and others looking to interact with the deployed protocol programatically.

## Overview

Like any protocol, the Reserve Protocol causes some amount of MEV. While the full extent is not known, here are some examples of known MEV opportunities:

1. Issuance/Redemption
2. Auctions

### 1. Issuance/Redemption

probably not necessary to describe

### 2. Auctions

To bid in the protocol's single-lot, atomic, falling-price dutch auctions, an MEV searcher needs to monitor all `Broker` instances associated with RTokens. Whenver a `Broker` emits a `TradeStarted(ITrade indexed trade, IERC20 indexed sell, IERC20 indexed buy, uint256 sellAmount, uint256 minBuyAmount)` event, the `trade.KIND()` can be checked to see what kind of trade it is.

- if trade.KIND() == 0, then it is a [DutchTrade](../contracts/plugins/trading/DutchTrade.sol)
- if trade.KIND() == 1, then it is a [GnosisTrade](../contracts/plugins/trading/GnosisTrade.sol)

#### DutchTrade

Bidding instructions from the `DutchTrade` contract:

`DutchTrade` (relevant) interface:

```solidity
function bid() external; // execute a bid at the current block timestamp

function sell() external view returns (IERC20);

function buy() external view returns (IERC20);

function status() external view returns (uint8); // 0: not_started, 1: active, 2: closed, 3: mid-tx only

function lot() external view returns (uint256); // {qSellTok} the number of tokens being sold

function bidAmount(uint48 timestamp) external view returns (uint256); // {qBuyTok} the number of tokens required to buy the lot, at a particular timestamp

```

To participate:

1. Call `status()` view; the auction is ongoing if return value is 1
2. Call `lot()` to see the number of tokens being sold
3. Call `bidAmount()` to see the number of tokens required to buy the lot, at various timestamps
4. After finding an attractive bidAmount, provide an approval for the `buy()` token. The spender should be the `DutchTrade` contract. Note that it is very important a tight approval is set! Do not set more than the `bidAmount()` for the desired bidding block.
5. Wait until the desired block is reached (hopefully not in the first 40% of the auction)
6. Call `bid()`. If someone else completes the auction first, this will revert with the error message "bid already received". Approvals do not have to be revoked in the event that another MEV searcher wins the auction. (Though ideally the searcher includes the approval in the same tx they `bid()`)

#### GnosisTrade

(TODO: write description of the (small and probably uninteresting) MEV opportunity associated with `GnosisTrade`]
