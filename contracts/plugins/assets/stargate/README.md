Submission Documentation

Twitter: MatthewJurenka, TG: mjurenka, Discord: fronts#7618,

This plugin provides support for the USDC, USDT, and ETH pools for
https://stargate.finance/. This plugin would also work for other LP tokens outside
the requirements of the bounty. StarTokenFiatCollateral.sol supports USDC and USDT,
while StarTokenSelfReferentialCollateral.sol supports ETH. For the USDC pool,
the collateral unit would be https://etherscan.io/token/0xdf0770df86a8034b3efef0a1bb3c889b8332ff56,
while the reference unit would be USDC, and a target unit of USD. A
NonFiatCollateral variant is not provided because Stargate does not yet support WBTC
or any similar tokens.

Deployment of a stargate collateral plugin follows the same interface as in
CTokenFiatCollateral. The only quirk is that Stargate has the liquidity pool
and ERC20 LP token as the same contract. Thus, simply pass in the correct pool
found in https://stargateprotocol.gitbook.io/stargate/developers/contract-addresses/mainnet
as a constructor argument.

Stargate LP tokens increase in value from fees taken as a result of the liquidity
pool being used for swaps. This gives them a significantly higher guarantee of safety
as opposed to setups like AAVE as they are not vulnerable to improper collateral liquidations.
The only way this plugin can default is as a result of a smart contract hack or
a depegging of the underlying.

If a default does occur, this plugin will be disabled following the same rules
and logic as for cTokens.

Please note that this submission includes complete tests, and works for all decimals
of LP tokens. Note that they also use the existing S* vault tokens, which allows
for more easy integration with other DeFi protocols.
