# Collateral Plugin - Lido liquid staking token - stETH

This document is a temporary file to accompany the source code changes in this gitcoin submission pull request. The
changes made add a collateral plugin enabling stETH to be used as collateral in the Reserve Protocol. All changes made
fall under the greater licence in this repository, BlueOak-1.0.0.
discord handle: aaron#7674

## Accounting units

The collateral unit held by reserve for this plugin is the wrapped version of Lido's liquid staking token, wstETH. The
wrapped version is used to avoid the complexity required to handle a rebasing token like stETH and to fit in with the
patterns used in existing plugins. The reference and target units are ether, and the unit of account is USD.

## refPerTok movements

The refPerTok() return value is found from stEthPerToken() in the wstETH token. Ultimately this value is the ratio of
the total ether held in lidos contracts to the total shares of ownership. The value for the total ether held by lido
validators in the beacon chain is updated by a lido oracle. The ratio should only increase under normal circumstances
because the validators should gain ether rewards over time which the oracle should report. For the value to decrease a
major error would need to occur, such as mass slashings due to a critical error by Lido validator operators. In this
case refresh() would read a value from refPerTok() which is less than the previously read value, and the
CollateralStatus state would transition to disabled.

## Implementation

### WSTETHCollateral

WSTETHCollateral inherits Collateral and the ICollateral interface. The constructor takes two additional arguments to
those passed through to Collateral, an extra stETH/ETH oracle for the market rate, and a threshold for when this
collateral should default due to stETH falling too far relative to ETH. The second oracle is necessary because it is
possible something could go catastrophically wrong with stETH like keys being lost or slashed validators. In the case
that something does go wrong such that stETH depegs, and reserve protocol would want this plugin to become disabled, it
can't be relied upon that the Lido oracle would decrease the stEthPerToken(), so it's safer to default if the
stETH/ETH oracle falls below the threshold. Both oracles used already exist and addresses have been added to the config,
they both use 18 decimals. The erc20 used as the token is the non rebasing wstETH.

### strictPrice()

Following the advice of tbrent in reserve protocols discord, "It's correct for price/strictPrice to return the best
estimate of the price of one {tok} using the true exchange rate to the reference unit", the strictPrice is calculated
from the product of chainlink oracles for ETH/USD, stETH/ETH and the wrapping ratio of wstETH/stETH. As anyone can
freely convert between wstETH and stETH any time a market price oracle is not required. If the market exchange rate of
stETH/ETH falls even though refPerTok increases, the strict price result can decrease.

### refresh()

Manages the state of the plugins CollateralStatus. There are three ways the collateral can soft default with a chance to
recover before the timeout, an error with the ETH/USD oracle, an error with the stETH/ETH oracle, or the stETH/ETH
oracle price falling below the threshold. Because the stETH oracle used is stETH/ETH the depeg test is simply a direct
comparison with the relative default threshold.

In the case that refPerTok ever returns a value lower than the previously read value the plugin will immediately hard
default and become disabled.

Compared to similar plugins there is a gas optimisation to save ~94 gas during normal usage where the status result is
unchanged from SOUND. Instead of always overwriting the status and incurring a 100 gas fee for setting a slot to the
same value, it compares first to see if it has changed, adding a DUP and EQ instead at a cost of ~6 gas.

Slither reports two warnings in refresh. One has been kept as one it is the recommended pattern to use in the reserve
protocol solidity style document for catching out of gas errors. The other is an ignored return value which is also OK,
we don't use the ETH/USD value to determine the status.

### refPerTok()

Returns the exchange rate for stETH/ETH from the wstETH token contract in uint192 fixed-point decimal value format.

### pricePerTarget()

Returns the price feed from chainlink of eth in usd, or UoA per target.

### claimRewards()

There are no rewards to claim in relation to wstETH, wstETH increases its value relative to eth. This function is
implemented and emits a log only for the sake of polymorphism, if another contract treats this plugin like one which
does need to claim rewards, it will not revert.

## Tests

Integration tests for the wstETH collateral plugin have been implemented following the template provided by the
CTokenFiatCollater test, they can be found at test/integration/individual-collateral/WSTETHCollateral.test.ts. A
dedicated script has been added in package.json to only run the tests added for this plugin, it can be run with "yarn
test:wsteth"

These tests avoid mocking any Lido contracts to ensure realistic behaviour and use the real addresses of
stETH and wstETH contracts on ethereum. refPerTok is manipulated by impersonating a lido oracle and modifying the value
representing the total ether held by Lido validators on the beacon chain. The tests
cover deployment, issuance/appreciation/redemption by updating each of the exchangeRate, ETH/USD oracle, and stETH/ETH
oracle, and edge cases relating to the price, status and oracles.

## Deployment

Deployment parameters are demonstrated in the WSTETHCollateral.test.ts which uses mainnet addresses that have been added
in configuration.ts. The value to use for defaultRelativeThreshold should be the minimum stETH value allowed relative to
ETH before soft defaulting as a value with 18 decimals, for example to default at 85% the value should be fp('0.85').
The following snippet demonstrates deploying this plugin with from an ethers script:

```typescript
// Deploy WSTETH collateral plugin
wstethCollateralFactory = await ethers.getContractFactory('WSTETHCollateral', {
  libraries: { OracleLib: oracleLib.address },
})
wstethCollateral = <WSTETHCollateral>(
  await wstethCollateralFactory.deploy(
    fp('1'),
    networkConfig[chainId].chainlinkFeeds.ETH as string,
    networkConfig[chainId].chainlinkFeeds.STETH as string,
    wsteth.address,
    config.rTokenMaxTradeVolume,
    ORACLE_TIMEOUT,
    ethers.utils.formatBytes32String('ETH'),
    defaultRelativeThreshold,
    delayUntilDefault
  )
)
```
