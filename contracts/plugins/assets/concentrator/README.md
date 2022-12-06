# Concentrator Aladdin Pools Collateral Plugin

AladdinDAO, through their product [Concentrator](https://concentrator.aladdin.club/#/vault), offers liquidity pools
on top of Convex pools that allow the compounding of the `cvxTokens` in an easy way,
while offering the `aTokens` as shares of the pool.

Currently, exists two _aPools_ on Concentrator, one for _CRV_ or _cvxCRV_, and one for _FXS_ or _cvxFXS_.

## What are the collateral token, reference unit, and target unit for this plugin?

This plugin can be deployed should be deployed twice to cover the existing pools:

`tok`: aCRV  
`ref`: CRV  
`target`: CRV  
`UoA`: USD

`tok`: aFXS  
`ref`: FXS  
`target`: FXS  
`UoA`: USD

## How does one configure and deploy an instance of the plugin?

Both pools have the same features, but they slightly differ on the interfaces that have implemented. There is a
function that has a different name, and in a try to generalize things and to allow future extensions in case there is
a deployment of a new pool, I tagged the differences in different pool versions. By doing so, in the future new
collateral
plugins can be deployed for future pools that comply with any of the existing versions, or if they differ again, only
the new traits can be implemented to deploy the new plugin.

The collateral plugin `aPoolCollateral` is the plugin that will be deployed for the `aCRV` and `aFXS` pools.

Will specify the required arguments for both of the pools:

### aCRV pool

fallbackPrice: 0.65e18  
uoaPerTargetFeed: CRV/USD price feed: `0xCd627aA160A6fA45Eb793D19Ef54f5062F20f33f`  
erc20Collateral: Address of the `aCRV` token : `0x2b95A1Dcc3D405535f9ed33c219ab38E8d7e0884`  
targetName : `CRV`  
version : 1

### aFXS pool

fallbackPrice: 4e18  
uoaPerTargetFeed: FXS/USD price feed: `0x6Ebc52C8C1089be9eB3945C4350B68B8E4C2233f`  
erc20Collateral: Address of the `aFXS` token : `0xDAF03D70Fe637b91bA6E521A32E1Fb39256d3EC9`  
targetName : `FXS`  
version : 2

## Why should the value (reference units per collateral token) decrease only in exceptional circumstances?

The reference units per collateral token is a function of the total staked `cvxTokens` divided by the total minted
`aTokens`. The only way to increase `aTokens` is through depositing liquidity on the pool, and over time the pool
harvests and compounds the rewards from the Convex pools. Therefore, the value of a share(`aToken`) will only go up
over time.

In the case were the reference per token ratio decreases for some liquidity leak, the plugin will default.

## How does the plugin guarantee that its status() becomes DISABLED in those circumstances?

The plugin keeps track of the last reference per token seen, and if it ever goes down any amount, the plugin
will immediately default.

Since the reference and the target are the same there is no other peg being checked, so there is no soft default
strategy.