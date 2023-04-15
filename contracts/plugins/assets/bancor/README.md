Submission Documentation

Twitter: MatthewJurenka, TG: mjurenka, Discord: #7618, 

This submission mirrors the Compound V2 family of plugins to allow support
for all pools on Bancor v2. As such the collateral token, reference unit,
and target unit would change depending on the desired pool that is desired.
For example for the USDT pool, the reference unit would be USDT, the target unit
would be USD, and the collateral token would be bnUSDT.

Deploying an instance of this plugin mirrors the same interface as the Compound
family of plugins. The main difference is the addition of the _underlying_token
and _network_info params, where (i.e. for the USDT pool) _underlying_token would
be the address to USDT, and _network_info would be the deployed BancorNetworkInfo
contract. The erc20 passed into CollateralConfig would be the Bancor LP token,
bnUSDT. You can find more information about Bancor's contracts at
https://docs.bancor.network/developer-guides/contracts

Ideally, Bancor's LP tokens increase in value as a result taken from fees on swaps
in the underlying liquidity pools. This mechanism by itself would result in a non-decreasing
source of revenue. Bancor is unique in that it allows users to only supply one half
of a liquidity pair, as opposed to Balancer and Uniswap that require two tokens.
The problem with this design is that if the protocol runs into trouble and there exists
a "deficit" in the value of the pool, a withdrawal penalty will be applied to the
underlying token when it comes time for a user to liquidate their position. This
deficit can be dramatic, for example USDC has a withdrawal penalty of 40%, USDT of -38%,
and ETH of 60%. In fact, almost all well-known tokens on the protocol have a serious 
withdrawal penalty, with only newer tokens retaining normal APYs. 

At a code level, this penalty is not reflected in the underlyingToPoolToken
and poolTokenToUnderlying conversion methods, which means that any plugin that
only relies on these to make refPerTok calculations is totally unfit for real-world
use, as the deficit would make the plugin think the (for example) bnUSDC token
is worth 66% more than it really is, and not recognize a default when the pool
enters into deficit. By taking into account the pool deficit during the refPerTok 
calculation, my plugin will properly default when a deficit arises.

If a default does occur, this plugin will be disabled following the same rules
and logic as for cTokens. 

Please note that this submission includes complete tests, and works for all decimals
of LP tokens.
