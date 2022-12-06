# Fixed rate lending positions - Notional Collateral Plugin

This plugin uses lending positions in Notional as a collateral.   
Lending positions in Notional are represented with an ERC1155 internally on the Notional core, therefore even though
the positions are transferable on the Notional system, they cannot be directly used as collateral on Reserve.  
To solve that issue, as also to add some extra feature, positions are wrapped with an extra contract that will
represent those positions in the form of an ERC20, so they can be used in a collateral plugin.

## What are the collateral token, reference unit, and target unit for this plugin?

This plugin can be deployed one time for each of the assets that Notional accepts, those are: USDC, DAI, ETC and WBTC.  
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

## How does one configure and deploy an instance of the plugin?

### If the deployer should plug in price feeds, what units does your plugin expect those price feeds to be stated in?

## Why should the value (reference units per collateral token) decrease only in exceptional circumstances?

## How does the plugin guarantee that its status() becomes DISABLED in those circumstances?

