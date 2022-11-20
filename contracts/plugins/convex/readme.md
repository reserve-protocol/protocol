# Convex Curve LP Collateral

- [Curve docs](https://resources.curve.fi/base-features/understanding-curve)
- [Convex docs](https://docs.convexfinance.com/convexfinance/)

## Summary

This collateral is built for convex staking pool which works on top of the curve’s infrastructure for AMM’s and staking of their LP tokens. 

To understand how to use convex staking as collateral, we first need to know how the curve works. 

Curve pools unlike uniswap Lp’s consist of more than 2 coins. For example 3Crv pool consists of 3 stables coins ( DAI, USDT and USDC). Depending LP token price, you will get the underlying token price. (Some underlying tokens will be valued slightly higher wtr token due to slippage at times.)

For 3CurvePool, the LP token is named 3Crv and its current value stands at 1.0225. More details can be found here - https://curve.fi/#/ethereum/pools/3pool/deposit

There are two contracts which are related to the pool. 
- Token contract - https://etherscan.io/address/0xdf5e0e81dff6faf3a7e52ba697820c5e32d806a8#readContract which is a simple ERC20 token 
- Pool contract - https://etherscan.io/address/0x45f783cce6b7ff23b2ab2d70e416cdb7d6055f51#readContract which contains the currency reserves and also the price at which the LP token can be exchanged for underlying assets. 

## Implementation

|  `tok`  | `ref` | `tgt` | `UoA` |
| :-----: | :---: | :---: | :---: |
| lpToken | Σ(underlyig tokens)/no of underlying tokens  |  USD  |  USD  |

Based on this we can derive the different values that we need to implmet the collateral

### refPerTok

We need to know how many underlying tokens we can get from selling the lpToken. Instead of doing a calculation of the ref and the lpToken in the smart contract, we can query it from the pool contract of curve. `.get_virtual_price()` give the lpTokens value. 

### refresh

This part is a bit tricky. Since we can exchange the token to any underlying asset, the question becomes which asset do we check the feed off. Another scenario is what happens if one of the tokens loses the peg. I am assuming if one of the stable coins has lost it's peg, the collateral is no longer sound. 

The refresh algorithm will go through all the available stable coins in the pool and check its chainlink price. If any one of them has depegged from the USD's price beyond a certain threshold, we can mark the status as IFFY. 

There are different thresholds for different coins. This is in consideration that different USD's behave differently. LUSD for example is designed in such a way that it can deviate upto 10% before their arbitrage mechanisms kick in. 

The implmentation of the collateral is present in `/contracts/plugins/assets/CurveStaleCoinLPCollateral.js`

### Deployment

1) Deploy `ConvexStakingWrapped.sol` and deposit all LP tokens using the staking wrapper. 
2) The deployed wrapper should give you the erc20 required to deploy the contract. Deploy collateral token
3) Initialize/set the base tokens for the stable coins and the collateral should be ready

Notes:
1) As you may have guessed by reading the collateral `setChainlinkPriceFeedsForStableCoins()` should be present in the construtor but ethereum has this weird issue where you cannot pass too many params in to a function i.e construtor in this case. So we split the initiation to two different functions.
2) This erc20 which reserve will need to create will not have a chainlink feed. So we'll need to use some dummy value instead. 