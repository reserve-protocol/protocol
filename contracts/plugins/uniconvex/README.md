# Convex Curve Pool Plugins

### Resources used

[Curve V1 whitepaper](https://curve.readthedocs.io/_/downloads/en/latest/pdf/)  
[Curve V2 whitepaper](https://classic.curve.fi/files/crypto-pools-paper.pdf) 
[Curve online docs](https://resources.curve.fi/base-features/understanding-curve) 

## Convex Curve Fiat Collateral

Contract source code: [UniconvexFiatCollateral](./UniconvexFiatCollateral.sol)

`{tok}` `Convex LP token`  
`{ref}` Synthetic reference `CURVED<A0>...<AN>` where N is the number of assets in a Curve pool, like `CURVEDDAIUSDCUSDT` for DAI/USDC/USDT  
`{target} = {UoA}` `USD`  
`{UoA}` `USD`

`{tok}` Collateral token, strictly speaking, is Convex LP token - the one users get for staking Curve LP tokens in Convex pools. Since all invariant-related math stays the same as in Curve, we don't mention Convex in `{ref}` naming.

`{ref}` Synthetic reference unit expressing StableSwap
invariant (v1), which is

 $$An^n \sum{x_{i}} + D = ADn^n + \dfrac{D^{n+1}}{n^n\prod{x_{i}}}$$ $$(ё)$$

TODO behavior - grows on trade fees, unchanged on fee-less trades

UniconvexFiatCollateral for tokens pegged to usd or eurocoins like stable pools DAI-USDC-USDT
* Expected: {tok} == {ref}, {ref} is pegged to {target} or defaults, {target} == {UoA}

UniconvexNonFiatCollateral can be used with any convex pool to claim rewards like stable pools which should no be retargeted or crypto pools like USDT-BTC-WETH
* Expected: {tok} == {ref}, {ref} is pegged to {target} or defaulting, {target} != {UoA}

How does one configure and deploy an instance of the plugin?
- Choise assets
- Choice curve pool corresponds to assets and mint lp tokens
- Choice convex pool and mint convex lp tokens
- Deploy collateral using constructor in usual way
- Curve (Convex) support 2+ assets in pools. So you need prepare feed for each asset.


If the deployer should plug in price feeds, what units does your plugin expect those price feeds to be stated in?
 {UoA}/ {Curve Coin(i)}

Why should the value (reference units per collateral token) decrease only in exceptional circumstances?
We use invariant designed to only increase

https://classic.curve.fi/files/crypto-pools-paper.pdf   v2
https://classic.curve.fi/files/stableswap-paper.pdf     v1

How does the plugin guarantee that its status() becomes DISABLED in those circumstances?
It compares refpertok with prev value

Implementation details
Uses @gearbox-protocol/integrations-v2" fork at "github:chainhackers/integrations-v2.
Solidity version changed to 0.8.9^ compare to valilla implementation.


References:

https://classic.curve.fi/files/CurveDAO.pdf
https://classic.curve.fi/files/crypto-pools-paper.pdf   v2
https://classic.curve.fi/files/stableswap-paper.pdf     (v1)
https://curve.readthedocs.io/exchange-cross-asset-swaps.html

https://www.curve.fi/contracts

# Matrix of fees
https://resources.curve.fi/crv-token/understanding-crv#the-crv-matrix

https://github.com/convex-eth/platform
https://docs.convexfinance.com/convexfinanceintegration/booster


https://docs.yearn.finance/vaults/yearn-lens/
Registry adapters have the ability to return metadata specific to an asset type (for example for vaults: pricePerShare, controller, etc.)

https://curve.readthedocs.io/registry-registry.html

https://github.com/yearn/yearn-lens/blob/584df312b84b005f2ae3668c5908de82d2e844cd/contracts/Oracle/Calculations/Curve.sol#L378=

https://github.com/yearn/yearn-lens/blob/master/contracts/Oracle/Calculations/Curve.sol

https://github.com/yearn/yearn-lens/tree/master/contracts/Oracle/Calculations




//TODO REPORT_GAS FOR REFRESH
//TODO use shutdown in REFRESH
//TODO shutdown in refresh

### Related Gitcoin bounties
[Collateral Plugin - Convex - Volatile Curve Pools
](https://gitcoin.co/issue/29515)   
[Collateral Plugin - Convex - Stable Curve Pools](https://gitcoin.co/issue/29516)

############## notes
// also allowed to implement price as min price for some circumferences https://dev.gearbox.fi/docs/documentation/oracle/curve-pricefeed/
