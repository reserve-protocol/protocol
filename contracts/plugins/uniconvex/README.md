# Convex Curve Pool Plugins

## Convex Curve Fiat Collateral

Contract source code: [UniconvexFiatCollateral](./UniconvexFiatCollateral.sol)

`{tok}` `Convex LP token`  
`{ref}` Synthetic reference `CURVED<A0>...<AN>` where N is the number of assets in a Curve pool, like `CURVEDDAIUSDCUSDT` for DAI/USDC/USDT  
`{target} = {UoA}` `USD`  
`{UoA}` `USD`

#### Implementation details and behavior

`{tok}` Collateral token, strictly speaking, is Convex LP token - the one users get for staking Curve LP tokens in Convex pools. Since all invariant-related math stays the same as in Curve, we don't mention Convex in `{ref}` naming.

`{ref}` Synthetic reference unit best expressed as 

$$\dfrac{D}{L}$$ 

where 
D = total amount of coins when the pool in in balanced state and all the coins have an equal price
L = total liquidity

The constant D is the same as in StableSwap invariant (v1) 
 $$An^n \sum{x_{i}} + D = ADn^n + \dfrac{D^{n+1}}{n^n\prod{x_{i}}}$$ $$(ё)$$

which can be seen as a mixture of Uniswap's constant-product invariant and constant-price invariant. Curve holds this equation true on every operation. 
* D stays unchanged on fee-less swaps and grows when pool receives fees without fees,
* L stays unchanged on swaps
* both D and L change on liquidity added / removed in such a way that D / L stays the same

The 3 bullet points above combined mean that `{ref}` keeps its value on every kind operation apart from swaps with fees, in which case `{ref}` grows. 


`{target}` = `{UoA}`

UniconvexFiatCollateral is meant for tokens all of which are pegged to USD  DAI-USDC-USDT
Expected: 
* {tok} == {ref}
* {ref} is pegged to {target}, otherwise the collateral defaults on refresh
* {target} == {UoA}

UniconvexNonFiatCollateral can be used with any convex pool to claim rewards like stable pools which should no be retargeted or crypto pools like USDT-BTC-WETH
* Expected: {tok} == {ref}, {ref} is pegged to {target} or defaulting, {target} != {UoA}

How does one configure and deploy an instance of the plugin?
- Choose assets - stablecoins pegged to USD like DAI, USDC, USDT
- Choose Curve pool containing your assets of choice and mint Curve LP tokens
- Choose Convex pool, stake Curve LP tokens to get your Convex LP tokens
- Deploy collateral using constructor in the usual way
- Curve (Convex) supports 2+ assets in pools. So you need prepare feed for each asset.


If the deployer should plug in price feeds, what units does your plugin expect those price feeds to be stated in?
 {UoA}/ {Curve Coin(i)}

#### Why should the value (reference units per collateral token) decrease only in exceptional circumstances?
see "Implementation details and behavior" section above
https://classic.curve.fi/files/crypto-pools-paper.pdf   v2
https://classic.curve.fi/files/stableswap-paper.pdf     v1

#### How does the plugin guarantee that its status() becomes DISABLED in those circumstances?
It relies on Curve pool contracts being non-upgradeable, audited and trusted to keep the invariant.

#### Development
Uses `@gearbox-protocol/integrations-v2` fork at `github:chainhackers/integrations-v2`,
Solidity version changed to 0.8.9^ in the fork.


## References:

https://classic.curve.fi/files/CurveDAO.pdf  
https://classic.curve.fi/files/crypto-pools-paper.pdf   v2  
https://classic.curve.fi/files/stableswap-paper.pdf     (v1)  
https://curve.readthedocs.io/exchange-cross-asset-swaps.html

https://www.curve.fi/contracts

https://resources.curve.fi/crv-token/understanding-crv#the-crv-matrix  
https://github.com/convex-eth/platform  
https://docs.convexfinance.com/convexfinanceintegration/booster  

### Related Gitcoin bounties
[Collateral Plugin - Convex - Volatile Curve Pools
](https://gitcoin.co/issue/29515)   
[Collateral Plugin - Convex - Stable Curve Pools](https://gitcoin.co/issue/29516)

