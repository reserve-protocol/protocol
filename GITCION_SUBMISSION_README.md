# Collateral Plugin - Rocket - RETH

This document is a temporary file to accompany the source code changes in this gitcoin submission pull request. The
changes made add a collateral plugin enabling RETH to be used as collateral in the Reserve Protocol. All changes made
fall under the greater licence in this repository, BlueOak-1.0.0.
discord handle: aaron#7674

## Accounting units

The collateral unit held by reserve for this plugin is the rocket pool liquid staking token, RETH. The reference and
target units are ether, and the unit of account is USD.

## refPerTok movements

The value will only increase in normal circumstances, refPerTok() if found from getExchangeRate() in the RETH token
contract. The exchange rate is determined by stored values in RocketStorage of total ether balance / total reth balance,
and these values are periodically updated by the ODAO multisig, whose members vote their values periodically. As RETH is
a liquid staking token the exchange rate should only increase as minipools earn rewards. For the value to decrease a
major error would need to occur in rocket pool, such as mass slashings due to a bug in client software. In this case
refresh() would read a value for refPerTok which is less than the previously read value, and the CollateralStatus state
would transition to disabled.

## Tests

Integration tests for the reth collateral plugin have been implemented following the template provided by the
CTokenFiatCollater test, they can be found at test/integration/individual-collateral/RethCollateral.test.ts. A dedicated
script has been added in package.json to only run the tests added for this plugin, it can be run with "yarn test:
reth"

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
prevReferencePrice which is used to check refPerTok is behaving safely.

One notable design choice is that similar to CToken collateral, an oracle is not used for the collateral units price.
This choice was made for many reasons: There is no chainlink oracle for reth right now, and the cost of creating and
updating a new custom reth oracle probably wouldn't make economic sense for this plugin. Because of the decentralised
nature of rocket pool such an oracle is not necessary, in the case that reth becomes worth far less than eth the
RethCollateral can be disabled anyway due to refPerTok decreasing. The ODAO would update rocket storage so that the
exchange rate would decrease. An additional downside of comparing a new custom reth oracle to the eth oracle is
increased complexity risk, higher gas costs due to extrta storage slot reads every refresh(), and an extra vulnerability
to manipulation of the relatively low liquidity reth oracle. Because of the significant costs and low value gained it
was decided a combination of an ethusd oracle and the exchange rate used by rocket pool for redemptions was the right
choice for this plugin.

### strictPrice()

Is found from the chainlink price feed for eth/usd multiplied by refPerTok() to give the systems price
for reth in USD.

### refresh()

Manages the state of the plugins CollateralStatus. It ensures it will become disabled if the value read from
refPerTok ever decreases. It becomes iffy if there is a problem with the price feed, in which case it has
delayUntilDefault seconds to recover.

Slither reports two warning in refresh. One has been kept as one it is the recommended pattern to use in the reserve
protocol solidity style document for catching out of gas errors. The other is an ignored return value which is also OK,
we don't care what price it returns as ether has no peg threshold to break.

### refPerTok()

Reads the exchange rate for reth to eth from the reth token contract. This is the rate used by rocket pool
when converting between reth and eth and is closely followed by secondary markets.

### pricePerTarget()

Returns the price feed from chainlink of eth in usd, or UoA per target.

### claimRewards()

There are no rewards to claim in relation to reth, reth increases it's conversion rate to eth inside
rocket pool. This function is implemented and emits a log only for the sake of polymorphism, if another contract treats
this plugin like there could be rewards to claim it will not revert.

## Deployment

Deployment parameters are demonstrated in the RethCollateral.test.ts which uses mainnet addresses that have been added
in configuration.ts. It is similiar to the deployment of CToken plugins but with a few less constructor args which are
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
