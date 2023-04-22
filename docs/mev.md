# MEV

This document is intended to serve as a resource for MEV searchers and others looking to interact with the deployed protocol programatically.

## Dutch Auctions

When revenue accumulates or when RToken basket changes occur, the protocol runs falling-price dutch auctions. MEV searchers may wish to bid in these auctions. The relevant portion of the BackingManager/RevenueTrader's interface is:

```solidity
// BackingManager
/// @return The ongoing auction as a Swap
function getDutchAuctionQuote() external view returns (Swap memory);

// RevenueTrader
/// @return The ongoing auction as a Swap
function getDutchAuctionQuote(IERC20 tokenOut) external view returns (Swap memory);

// Both
/// Execute the available swap against the trader at the current dutch auction price
/// @param tokenIn The ERC20 token provided by the caller
/// @param tokenOut The ERC20 token being purchased by the caller
/// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
/// @return The swap actually performed
function swap(
  IERC20 tokenIn,
  IERC20 tokenOut,
  uint256 amountOut
) external returns (Swap memory);

```

The `getDutchAuctionQuote()` function is on the BackingManager; the `getDutchAuctionQuote(IERC20)` function is on the RevenueTrader. This is because the BackingManager only offers one trade at a time, whereas the RevenueTrader may run simultaneous auctions for many tokens at once. Both have `swap()` functions.

To get the full set of ERC20s that could conceivably be inputs, call `assetRegistry.erc20s()` on the AssetRegistry for the RToken instance.

The `swap()` function uses the current block timestamp to calculate a price. The MEV searcher must have approved this amountIn in advance.

The `getDutchAuctionQuote` functions return a swap the size of the _full_ auction. An MEV searcher is welcome to bid on the entire lot. But they may also bid partially, without penalty.

Finally: the tokens being traded here may be Reserve-specific wrappers, and may require unwrapping before being tradeable in Defi more broadly.

## FacadeAct

The contract [contracts/facade/FacadeAct.sol](contracts/facade/FacadeAct.sol) provides a single calldata preparation function `getActCalldata(...)` that should be executed via [ethers.callStatic](https://docs.ethers.io/v5/api/contract/contract/#contract-callStatic).

```
function getActCalldata(RTokenP1 rToken) external returns (address to, bytes memory calldata_);
```

If the zero address is returned, then no action needs to be taken on the RToken instance at the moment.

If a nonzero address is returned, then the bot/caller can sign a tx addressed to the address returned, with the data bytes from the second return value. This may be a call such as:

- `rToken.main().furnace().melt()`
- `rToken.main().backingManager().manageTokens([...])`
- `rToken.main().rTokenTrader().manageToken(...)`
- `rToken.main().rsrTrader().manageToken(...)`
- `rToken.main().stRSR().payoutRewards()`
- etc

You'll definitely want to simulate the tx first though, to understand the gas cost and decide whether you actually want to execute it.
