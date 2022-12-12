Implements

https://gitcoin.co/issue/29517
Collateral Plugin - Uniswap V2 

What are the collateral token, reference unit, and target unit for this plugins?
UniswapV2FiatCollateral for tokens pegged to usd or eurocoins like DAI-USDC
* Expected: {tok} == {ref}, {ref} is pegged to {target} or defaults, {target} == {UoA}

UniswapV2NonFiatCollateral can be used with any convex pool to only claim rewards like USDT-WETH
* Expected: {tok} == {ref}, {ref} is pegged to {target} or defaulting, {target} != {UoA}

How does one configure and deploy an instance of the plugin?
- Create position on uniswap v2
- Deploy collateral using constructor in usual way
- One feed per asset

If the deployer should plug in price feeds, what units does your plugin expect those price feeds to be stated in?
 {UoA}/ {Uniswap position asset}
 
Why should the value (reference units per collateral token) decrease only in exceptional circumstances?
We use invariant designed to only increase
https://uniswap.org/whitepaper.pdf

How does the plugin guarantee that its status() becomes DISABLED in those circumstances?
It rely on well-known uniswap v2 math. No any additional checks of refpertok

Implementation details
Uses @gearbox-protocol/integrations-v2" fork at "github:chainhackers/integrations-v2.
Solidity version changed to 0.8.9^ compare to valilla implementation.
