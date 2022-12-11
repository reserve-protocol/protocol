# Fixed rate lending positions - Notional Collateral Plugin

This plugin uses lending positions in Notional as a collateral.   
Lending positions in Notional are represented with an ERC1155 internally on the Notional core, therefore even though
the positions are transferable on the Notional system, they cannot be directly used as collateral on Reserve.

Reserve
creates [its own ERC20 wrapper](https://docs.notional.finance/developer-documentation/how-to/lend-and-borrow-fcash/wrapped-fcash)
for their lending positions, but those contracts are tied to the maturity date and have to be renewed every time
they roll out the markets, therefore we need a higher abstraction.

To solve that issue, as also to add some extra feature, positions are wrapped with an extra contract that will
represent those positions in the form of an ERC20, so they can be used in a collateral plugin.

## What are the collateral token, reference unit, and target unit for this plugin?

This plugin can be deployed one time for each of the assets that Notional accepts, those are: USDC, DAI, ETH and WBTC.  
As such, the possible configurations for the plugin are the following:

`tok`: fUSDC  
`ref`: USDC  
`target`: USD  
`UoA`: USD

`tok`: fDAI  
`ref`: DAI  
`target`: USD  
`UoA`: USD

`tok`: fETH  
`ref`: ETH   
`target`: ETH  
`UoA`: USD

`tok`: fWBTC  
`ref`: WBTC   
`target`: BTC  
`UoA`: USD

Since USDC/DAI have different assumptions than ETH/WBTC, there are two collateral files to make the plugin work as
intended.

The **fCashFiatPeggedCollateral** is used for USDC/DAI. Needs to check the peg of the reference to the target.
The **fCashNonFiatPeggedCollateral** is used for WBTC. Needs to check the peg and convert to `UoA`.
The **fCashStaticCollateral** is used for ETH. No need to check the peg.

## How does one configure and deploy an instance of the plugin?

### Wrappers

First we'll need to deploy the wrappers.   
Ever wrapper will need the address of the _Notional Proxy_ and _Wrapped fCash Factory_, both can be found
[here](https://docs.notional.finance/developer-documentation/).

#### WETH

`underlyingAsset`: [WETH address](https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)  
`currencyId`: 1

#### DAI

`underlyingAsset`: [DAI address](https://etherscan.io/token/0x6b175474e89094c44da98b954eedeac495271d0f)  
`currencyId`: 2

#### USDC

`underlyingAsset`: [USDC address](https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48)  
`currencyId`: 3

#### WBTC

`underlyingAsset`: [WBTC address](https://etherscan.io/token/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599)  
`currencyId`: 4

### Collateral Plugins

For every asset wrapper that we deployed we shall deploy a collateral plugin. I will only detail below the
relevant unique argument for the plugin, other like `maxTradeVolume`, `oracleTimeout`, `delayUntilDefault` and
`defaultThreshold` are generally known and can be decided at deploy time.

Apart from that, those two values can be described generally:

`fallbackPrice`: accepted fallback price of the underlying asset  
`allowedDropBasisPoints`: `70` (0.7%) minimum, should consider `100` to give some more room. As of now
a bigger fall than 0.7% should never happen, but we risk a hard default by setting it this close.

#### USDC

Plugin: **fCashFiatPeggedCollateral**

`targetPerRefFeed`: USDC/USD price feed: `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6`  
`erc20Collateral`: address of the USDC wrapper  
`targetName`: `USD`

#### DAI

Plugin: **fCashFiatPeggedCollateral**

`targetPerRefFeed`: DAI/USD price feed: `0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9`  
`erc20Collateral`: address of the DAI wrapper  
`targetName`: `USD`

#### WBTC

Plugin: **fCashNonFiatPeggedCollateral**

`targetPerRefFeed`: WBTC/BTC price feed: `0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23`  
`uoaPerTargetFeed`: BTC/USD price feed: `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c`  
`erc20Collateral`: address of the WBTC wrapper  
`targetName`: `BTC`

#### WETH

Plugin: **fCashStaticCollateral**

`uoaPerTargetFeed`: ETH/USD price feed: `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`   
`erc20Collateral`: address of the WETH wrapper  
`targetName`: `ETH`

### If the deployer should plug in price feeds, what units does your plugin expect those price feeds to be stated in?

For each of the Chainlink price feeds that we are using it's always 8 decimals, but the `OracleLib` will convert
everything to 18 decimals, so all the prices returned by the plugin `price`/`strictPrice` will always be D18.

## How does the plugin guarantee that its status() becomes DISABLED in those circumstances?

For all the collateral types the plugin uses a revenue hiding strategy. It does in order to allow for a small drop in
value that happens when reinvesting or entering a market, and also when estimating the current value if we were to 
redeem right now. Theoretically the drop is 0.6% at maximum(0.3% for entering the market + 0.3% for checking
the current value), but some basis points can get behind on the roundings and estimations, so 0.7% is a minimum value. 

Therefore, for all types of assets there will be a hard default if the `refPerTok` falls below the minimum accepted
value.

Then, for the asset USDC and DAI, also the peg of the token will be check in order to make sure that
the reference keeps pegged to the target, and if it loses the peg it will happen a soft default.

---

# Reserve fCash wrapper contract

We create a wrapper to store the lending positions and create a new token that will be used as collateral by the plugin.

For each of the supported assets there will be a collateral plugin, and for each plugin there will be a wrapper. That
means that four instances of the wrapper will have to be deployed to give service to the four plugins.

## Overview

The basic functionality of the wrapper is to manage the lending and redeeming process from the lending pools of
Notional.
A user would use the wrapper by depositing some assets, and in that same transaction the wrapper would lend those
assets on Notional and store the shares of the position(fCash) on the contract. The wrapper then would mint
some tokens and assign them to the user.

Those tokens represent the share of the user over the wrapper whole pool of assets. At any moment in time the user
can come and withdrawn the tokens, and the wrapper will simply redeem the fCash proportional to the shares and return
the original assets plus some profits for the lending time.

Since we are lending to Notional and lending pools there have a maturity date, meaning they reach a time when they stop
producing profits, the main task of the wrapper is keep track of which pools it has open positions on; be able to
detect when there is a market that has matured already; and when that happens, it basically redeems and re-lends
everything again on the next most profitable market. A process that we call _reinvesting_.

The wrapper is basically compounding all the assets it has under its management over the cycles, for as long as
it has custody of them.  
This is how the wrapper creates a `refPerTok`, by tracking how much value went in and how much value is that worth
right now.

## Why should the value (reference units per collateral token) decrease only in exceptional circumstances?

The `refPerTok` will only increase in time because all the assets going into the wrapper will be managed globally,
meaning we can think of this wrapper as if it was an investment fund, where you lend money while they operate with it.
You keep some tokens that represent your share over the total value of the fund, and you can redeem your portion
anytime.

Over time the wrapper will generate profits, therefore the value of your shares will always go up, and whenever
someone withdraws some of them, the amount of assets leaving the wrapper will be proportional to the shares being burnt,
therefore the _price per share_(`refPerTok`) will keep the same.

The only case that needs a special treatment is when the last token is burnt, meaning the last owner redeemed its
assets. In that case we store the current `refPerTok`, and in the future we will use it as a starting point, so
whenever users come and deposit again future profits will be increasing the previous `refPerTok`.

Doing that we make sure that `refPerTok` will be a monotonically increasing value, and as long as Notional has
lending pools that have a positive APY, we will be able to lend and reinvest to compound our profits.

## Use

Right now users can choose to simply `deposit`, which will automatically pick the market with highest APY, or
`depositTo` where they can choose the maturity of the market they deposit.

At any time they can `withdraw` any amount of tokens they own.

## Market selection

At the moment of writing, the strategy to select the _most profitable market_ it's just to select the biggest APY rate.
A possible improvement on that would be run a compounding formula to see if it's better do a long market with big APY,
or a short market with a bit lower APY but that will be able to be compounded more often.

There is two issues that should be pointed there: a) entering a market has a 0.3% annualized fee, and that should
be taken into account if a compounding formula is tried to be implemented to compute profitability. b) even when 
we know the rates of the short-term markets right now, it doesn't mean they will keep the same for next short-term 
markets. Thus making quite hard to actually estimate the returns of the compounding.

For those reason I decided to keep it simple right now, and simply select the biggest APY on sight, rinse and repeat.

---

# Notional protocol details

-

Entering a market has a cost of 0.3% annualized fee.
Entering a 1-year tenor market after 9 months costs 0.075%. Same as if you enter the 3-months tenor the first day.

Exiting a market has no cost if you wait for the market for maturity, if you exit the position before maturity
it has the same cost as entering, 0.3% annualized fee, reducing the closer it gets to the end.

-

Notional ETH asset is the native coin, but the Notional fCash wrapper uses WETH to make everything standard.

To make it easy for users, the Reserve fCash wrapper could enable a function to wrap Ether into WETH, but in that
case we should also track if the current instance of the contract is actually the one dealing with WETH, and that
forces us to either hardcode a `currencyId` on the contract or to add a new argument to the constructor.  
To keep this simple I did not add such helper.

-

Rates in the pools are a result of the liquidity's balance. The more liquidity you add the lower the rate you get.
The best performance is gotten with lower amounts. By extension, there is a point where you cannot enter the market 
with too much liquidity because it would bring the rates to negative values.

That will eventually be a problem on a compounding strategy because we will keep lowering the performance until
a point where we won't be able to lend any more because of too much liquidity.

A possible temporary solution would be to detect when this happens and split the liquidity among different tenors,
so we keep getting profits from different lending markets instead of betting all into the same one.