# Collateral Plugin - Coinbase liquid staking token - cbETH

This document is a temporary file to accompany the source code changes in this gitcoin submission pull request. The
changes made add a collateral plugin enabling cbETH to be used as collateral in the Reserve Protocol. All changes made
fall under the greater licence in this repository, BlueOak-1.0.0.
discord handle: aaron#7674

## Accounting units

The collateral unit held by reserve for this plugin is the coinbase liquid staking token, cbETH. The reference and
target units are ether, and the unit of account is USD.

## refPerTok movements

The refPerTok() return value is found from exchangeRate() in the cbETH token. The value is updated by a coinbase oracle
to set the redemption rate between cbETH and ETH. As time goes on coinbase validators should only earn more rewards
which will increase the ratio of their ETH:cbETH so under normal conditions the result from refPerTok should only
increase. For the value to decrease a major error would need to occur, such as mass slashings due to a critical error by
coinbase validator operators. In this case refresh() would read a value from refPerTok() which is less than the
previously read value, and the CollateralStatus state would transition to disabled.

## Implementation

### CBETHCollateral

CBETHCollateral inherits Collateral and the ICollateral interface. The constructor takes two additional arguments to
those passed through to Collateral, an extra oracle for the cbETH/ETH market rate, and a threshold for when this
collateral should default due to cbETH falling too far relative to ETH. The second oracle is necessary because it's
possible something could go catastrophically wrong with cbETH such as keys being lost or slashed validators. In the case
that something does go wrong such that cbETH depegs and reserve protocol would want this plugin to become disabled, it
can't be relied upon that the coinbase oracle would decrease the exchangeRate(), so it's safer to default if the
eth/cbETH oracle falls below the threshold. Both oracles used already exist and addresses have been added to the config,
they both use 18 decimals.

### strictPrice()

Following the advice of tbrent in reserve protocols discord "It's correct for price/strictPrice to return the best
estimate of the price of one {tok} using the true exchange rate to the reference unit, not the return value of
refPerTok()", the strictPrice is calculated from the product of chainlink oracles for USD/ETH and ETH/cbETH. So if the
market exchange rate of ETH/cbETH falls even though refPerTok increases the strict price result will decrease.

### refresh()

Manages the state of the plugins CollateralStatus. There are three ways the collateral can soft default with a chance to
recover before the timeout, an error with the USD/ETH oracle, an error with the cbETH/ETH oracle, or the cbETH/ETH
oracle price falling below the threshold.

In the case that refPerTok ever returns a value lower than the previously read value the plugin will immediately hard
default and become disabled.

Compared to similar plugins there is a gas optimisation to save ~94 gas during normal usage where the status result is
unchanged from SOUND. Instead of always overwriting the status and incurring a 100 gas fee for setting a slot to the
same value, it compares first to see if it has changed, adding a DUP and EQ instead at a cost of ~6 gas.

Slither reports two warnings in refresh. One has been kept as one it is the recommended pattern to use in the reserve
protocol solidity style document for catching out of gas errors. The other is an ignored return value which is also OK,
we don't use the eth/usd value to determine the status.

### refPerTok()

Returns the exchange rate for cbETH to ETH from the cbETH token contract in uint192 fixed-point decimal value format.
This is the rate which will be used by coinbase when redeeming between cbETH and ETH.

### pricePerTarget()

Returns the price feed from chainlink of eth in usd, or UoA per target.

### claimRewards()

There are no rewards to claim in relation to cbETH, cbETH increases its conversion rate to eth. This function is
implemented and emits a log only for the sake of polymorphism, if another contract treats this plugin like another which
does need to claim rewards it will not revert.

## Tests

The cbETH/ETH oracle was added after the block usually used by reserve protocol fork tests. Because of that these tests
are designed to run against MAINNET_BLOCK=16135362. To solve this the before step resets the hardhat network to fork at
that block, and the after step sets it back to default for the next tests.

Integration tests for the cbETH collateral plugin have been implemented following the template provided by the
CTokenFiatCollater test, they can be found at test/integration/individual-collateral/CBETHCollateral.test.ts. A
dedicated script has been added in package.json to only run the tests added for this plugin, it can be run with "yarn
test:cbeth"

These tests avoid using cbETH mocks to ensure realistic behaviour of the cbETH token and use the real addresses of
cbETH contracts on ethereum. refPerTok is manipulated by impersonating the coinbase oracle and updating the
exchangeRate. The tests
cover deployment, issuance/appreciation/redemption by updating each of the exchangeRate, USD/ETH oracle, and ETH/cbETH
oracle, and edge cases relating to the price, status and oracles.

## Deployment

Deployment parameters are demonstrated in the CBETHCollateral.test.ts which uses mainnet addresses that have been added
in configuration.ts. The value to use for defaultRelativeThreshold should be the minimum cbETH value allowed relative to
ETH before soft defaulting as a value with 18 decimals, for example to default at 85% the value should be fp('0.85').
The following snippet demonstrates deploying this plugin with from an ethers script:

```typescript
// Deploy CBETH collateral plugin
cbethCollateralFactory = await ethers.getContractFactory('CBETHCollateral', {
    libraries: {OracleLib: oracleLib.address},
})
cbethCollateral = <CBETHCollateral>(
    await cbethCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        networkConfig[chainId].chainlinkFeeds.CBETH as string,
        cbeth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultRelativeThreshold,
        delayUntilDefault
    )
)
```
