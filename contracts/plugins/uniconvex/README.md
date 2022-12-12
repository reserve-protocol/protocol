Implements

https://gitcoin.co/issue/29515
Collateral Plugin - Convex - Volatile Curve Pools 

https://gitcoin.co/issue/29516
Collateral Plugin - Convex - Stable Curve Pools

What are the collateral token, reference unit, and target unit for this plugins?
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
https://classic.curve.fi/files/stableswap-paper.pdf     v1
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
