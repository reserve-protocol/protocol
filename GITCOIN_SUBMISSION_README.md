# Collateral Plugin - Rocket - RETH

This document is a temporary file to accompany the source code changes in this gitcoin submission pull request. The
changes made add a collateral plugin enabling RETH to be used as collateral in the Reserve Protocol.
All changes made fall under the greater licence in this repository, BlueOak-1.0.0.
discord handle: aaron#7674

## Accounting units

The collateral unit held by reserve for this plugin is the rocket pool liquid staking token, RETH. The reference and
target units are ether, and the unit of account is USD.

## refPerTok movements

The value will only increase in circumstances in which the collaterals status should remain SOUND. refPerTok() is found
from getExchangeRate() in the RETH token contract. The exchange rate is determined by stored values in RocketStorage of
total ether balance / total reth balance, and these values are periodically updated by the ODAO multisig. As RETH is a
liquid staking token the exchange rate will increase as minipools earn rewards, it is not a volatile value like a price
feed. For the value to decrease a catastrophic error would need to occur in rocket pool, such as mass slashings due to a
critical bug in the client software. In this case refresh() would read a value for refPerTok which is less than the
previously read value as the ODAO would vote in a value for total eth which is lower, and the CollateralStatus state
would transition to disabled.

Because the value should only increase, and has never decreased as shown in https://dune.com/queries/1286351/2204365 ,
demurrage or revenue hiding is not employed. They have downsides of additional complexity risk, cause inconsistency to
the Rtokens price, and increase gas costs significantly as they require regularly updating additional storage slots.
There's a limit to the frequency the ODAO can update the values in RocketStorage, so for the eth balance to decrease
without the reth balance also decreasing in equal proportion, any losses would have to outweigh the gains made by the
other ~500k eth rocket pool is staking, so one minipool misbehaving would not be an issue. This was confirmed with
rocket pool devs in their discord:
> Valdorff — 11/27/2022 2:19 AM
>
> In order to go down, penalties would need to be larger than rewards across the ~day between oracle updates
>
> You can see the what the peg actually has done here: https://dune.com/queries/1286351/2204365
>
> Very very very unlikely this number goes down. Would probably take a huge client bug.

## Tests

Integration tests for the reth collateral plugin have been implemented following the template provided by the
CTokenFiatCollater test, they can be found at test/integration/individual-collateral/RethCollateral.test.ts. A dedicated
script has been added in package.json to only run the tests added for this plugin, it can be run with "yarn test:
reth". The common fork block from mainnet is used, 14916729.

These tests avoid the use of any mocks to ensure realistic behaviour of the reth system and use the real addresses of
rocket pool contracts on ethereum. How to manipulate the exchange rate up and down in tests without resorting to
deploying mocks was not as simple as depositing ether, as values are instead modified by the ODAO multisig. To achieve
this the rocket pool balances contract was impersonated and used to write values in rocket storage directly. The tests
cover deployment, issuance/appreciation/redemption, and edge cases relating to the price and status and oracles.

## Implementation

### RethCollateral

RethCollateral inherits Collateral and the ICollateral interface. The constructor takes the same parameters as
Collateral, there is no need for anything additional as in the case of CToken plugins because it is made only for reth,
and the units used by target and reference are shared. The only state set during construction is initialising the
prevReferencePrice which is used to check refPerTok is behaving safely. The ETH/USD chainlink oracle used gives a price
with units of 18 decimal places.

One notable design choice is that similar to CToken collateral, an oracle is not used for the collateral units price.
This follows advice from tbrent in discord "seems right to me. We can upgrade the plugin in the future when an rETH feed
comes online". Communicating with rocket pool devs I found while they are pushing for a chainlink reth oracle they do
not know when one could be available, nor whether it would be eth/reth or reth/usd. As a result this plugin does not
take the market price of reth into account, and instead assumes that the peg to USD/ETH * getExchangeRate() is perfect.
It is likely as beacon chain withdrawals are enabled soon that this will be a very accurate assumption, and in the case
of a major slashing event there would be no issue as the ODAO will decrease the value for total eth and the collateral
plugin will be disabled anyway due to refPerTok decreasing. But there is some risk the RETH/ETH depegs for some other
reason which does not disable the plugin, so ideally it would be upgraded in future to include a reth oracle and leave
reth as an equally strong basket member of a diverse liquid staking RToken. There is no ability to modify the contract
in place to add an oracle as that would break the zero governance goal post deployment.

### strictPrice()

Is found from the chainlink price feed for eth/usd multiplied by refPerTok() to give the systems price
for reth in USD. If the RETH plugin is upgraded after a RETH oracle is available this should be modified to use the
oracle result rather than refPerTok().

### refresh()

Manages the state of the plugins CollateralStatus. It ensures it will become disabled if the value read from
refPerTok ever decreases. It becomes iffy if there is a problem with the price feed, in which case it has
delayUntilDefault seconds to recover.

Compared to similar plugins there is a gas optimisation to save ~94 gas during normal usage where the status result is
unchanged from SOUND. Instead of always overwriting the status and incurring a 100 gas fee for setting a slot to the
same value, it compares first to see if it has changed, adding a DUP and EQ instead at a cost of ~6 gas, and only does
the SSTORE if it's a new value which should be the rare flow.

Slither reports two warning in refresh. One has been kept as one it is the recommended pattern to use in the reserve
protocol solidity style document for catching out of gas errors. The other is an ignored return value which is also OK,
we don't care what price it returns as ether has no peg threshold to break.

### refPerTok()

Gets the exchange rate for reth to eth from the reth token contract and returns it in uint192 fixed-point decimal value
format. This is the rate used by rocket pool when converting between reth and eth and is closely followed by secondary
markets.

### pricePerTarget()

Returns the price feed from chainlink of eth in usd, or UoA per target.

### claimRewards()

There are no rewards to claim in relation to reth, reth increases its conversion rate to eth inside
rocket pool. This function is implemented and emits a log only for the sake of polymorphism, if another contract treats
this plugin like there could be rewards to claim it will not revert.

## Deployment

Deployment parameters are demonstrated in the RethCollateral.test.ts which uses mainnet addresses that have been added
in configuration.ts. It is similar to the deployment of CToken plugins but with a few less constructor args which are
not required. The following snippet demonstrates deploying this plugin with from an ethers script:

```typescript
reth = <IReth>await ethers.getContractAt('IReth', networkConfig[chainId].tokens.RETH || '')

// Deploy RETH collateral plugin
rethCollateralFactory = await ethers.getContractFactory('RethCollateral', {
    libraries: {OracleLib: oracleLib.address},
})
rethCollateral = <RethCollateral>(
    await rethCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        reth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        delayUntilDefault
    )
)
```
