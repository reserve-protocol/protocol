**START HERE**

# Protocol Overview

## Overview

The Reserve Protocol is a system that allows users to create and redeem RTokens, ERC20 tokens that represent baskets of multi-unit value. In simple cases the basket can be defined to target all one unit, such as USD, or ETH, but in general any unit can be put within a basket if there is collateral for it.

For example: an RToken can represent some small fraction of ETH, mostly USD, and maybe a little gold, too. The protocol is designed to be flexible and extensible, allowing users to create their own definitions of value. It also enables control over how revenue should be shared, whether that be between RToken holders, RSR stakers, or arbitrary third-party destinations that may play important roles in the life of that RToken.

It is deployed as a set of immutable implementation smart contracts. Through the Deployer contract users can deploy their own proxy contracts using the logic of the implementations.

## Core Components

1. Main: This is the core contract that manages the Reserve Protocol. It is responsible for registering new components, providing access control, and handling governance actions. It is the hub of core components, connected to each other component.
2. AssetRegistry: This contract is responsible for maintaining a registry of permitted assets.
3. BasketHandler: This contract is responsible for managing the definition of a "basket unit" for each RToken.
4. BackingManager: This contract is responsible for rebalancing the backing collateral for each RToken. It is where the collateral is actually held. It launches trades through the Brokerwhen the basket is undercollateralized.
5. Broker: This contract is responsible for dispatching instances of trading plugins to mediate interaction with external trading platforms. (or: our own dutch auctions)
6. Distributor: This contract is responsible for maintaining a table that describes how to divide revenue. It never holds any funds itself.
7. Furnace: This contract is responsible for melting RTokens, distributing yield to RToken holders. Any RToken transferred into it will slowly be melted, removing RTokens from supply and allocating their backing indirectly to all other holders.
8. StRSR: This is an ERC20 contract responsible for managing the staked RSR token, including the payout of RSR rewards and slashing during RSR seizure.
   Warning! When _all_ RSR is seized, balances will be reset to zero. While this does not technically break the ERC20 standard it is certainly unexpected functionality and therefore should be emphasized. Allowances are also reset.
9. RToken: This is an ERC20 contract responsible for managing the issuance and redemption of RTokens based on the logic of the BasketHandler and BackingManager's tokens. It maintains a (best-effort) appreciating exchange rate between RTokens and "basket units".
10. RevenueTrader: This contract is responsible for launching revenue trades, which go through the Broker and eventually become split by the Distributor to their destinations.

## Plugins

### Trading

There are two types of auctions (currently) supported by the protocol: dutch auctions and batch auctions.

#### Dutch auctions (DutchTrade)

A falling price dutch auction. Tokens are transferred out into oneshot `DutchTrade` contracts (clones) and MEV searchers bid against the individual trade contract.

The preferred type of trading method. Atomic, cheapest in gas terms, but inherently requires an assumption about price, since a starting price must be chosen.

The protocol attempts to account for this by starting with a very high price, but it is still possible in corner cases for this to be insufficient, for example in the case of a read-only reentrancy attack in an underlying protocol. Any trades that clear in the geometric phase (first 20%) of the auction will result in dutch trades being disabled for the two tokens being traded. To cause this intentionally requires donating at least 50% surplus to the protocol in the trade. Typically the auction will clear in the middle to end where there is much more precision in pricing.

To ensure trading liveness, as a fallback the protocol uses an approach to batch auctions called [EasyAuction, from Gnosis](https://github.com/gnosis/ido-contracts/tree/main).

#### Batch auctions (GnosisTrade)

Batch trades represent a more costly and higher dimensional form of trading that have the benefit of not requiring any assumptions about price. However since they are more expensive, and non-atomic, they are reserved to be the fallback method of trading (though strictly speaking either auction can be used).

Tokens are transferred out into (our deployment) of Gnosis' EasyAuction platform to be auctioned off. Bidders must place bids in the contract (incl capital) during the allotted time, and at the end of the auction the bids are sorted best to worst and a next-price clearing price is found. The incentives of this auction encourage bidders to place bids that represent their true preferences, since the _next_ price is used. The only downside to the mechanism is the legibility; ideally the batch auction would be sealed-bid to reach optimality, but this is not possible in practice.

However, batch trades should be always available, making them a reliable foundation for trading liveness in the overall model of the protocol. This comes with one caveat, which is that GnosisTrade tries to detect if the EasyAuction platform adheres to the provided slippage constraints; if it does not, then the trading method is disabled. This is similar to observing the outcome of a Uniswap trade and halting trading if the min amount out constraints you set were not met (which should not happen!).

### Trusted Fillers (only for Dutch Auctions)

As an alternative to bidding on **Dutch Auctions**, Rtokens >=4.2.0 are integrated with [Trusted Fillers](https://github.com/reserve-protocol/trusted-fillers/) and can be enabled by governance to allow async fillers to compete in auctions to provide better prices. All auction limitations still apply to these fillers. Currently, the only supported async filler is CoW Swap.

### Assets

The protocol requires an asset in order to handle an ERC20. Some assets are `collateral` assets, meaning they enable the ERC20 to be used as a backing collateral for RTokens.

Pure assets provide USD pricing information only.

#### Collateral

The more interesting type of asset is a _collateral_ asset. A collateral asset provides additional `refPerTok` and `targetPerRef` exchange rates that allow revenue to be measured against some external unit, called the "target unit". These contracts maintain an overall `status() view returns (CollateralStatus)` enum that the BasketHandler uses to define an overall notion of basket status. If the collateral ever becomes DISABLED, the BasketHandler will swap it out for a SOUND collateral in the appropriate quantity.

In general they can be arbitrarily complicated, and their development is better described over at [collateral.md](./collateral.md).

## Facades

Facades are not part of the core protocol. They are more like outer periphery contracts that support targeted interaction or monitoring of the protocol.

### FacadeWrite

The most important facade is the `FacadeWrite` contract, since it consumes the `Deployer` and performs other setup actions in order to prepare a new RToken.

### Facade

The Facade is a single contract that maintains a list of external implementation addresess and byte4 selectors. It dispatches any call it receives to one of the implementation contracts via delegatecall. This allows the Facade to be upgraded in-place, and minimizes the amount of new code that needs to be deployed to the chain per upgrade.

Each implementation contract is called a "Facet". A Facet can be saved to the Facade.

## Governance

Each RToken also has a governing body composed of its StRSR stakers. This is not hard-coded in the protocol, but provided as an option for RToken creators as deployment. Still, most RTokens are deployed with decentralized governance.

### Governor

The Governor works in the standard sort of way, with a (i) snapshot delay period; (ii) voting period; and (iii) timelock delay period. Quorum is defined based on the number of FOR and ABSTAIN votes, and proposal threshold is defined as a percentage of the total supply of StRSR.

In the event that StRSR balances are wiped out, proposals created before that date will not be able to be queued in the timelock or executed after.

### Timelock

Standard timelock. Usually 3 days.

### Guardian

The Guardian is simply our name for an address that has the cancellation power in the timelock.
