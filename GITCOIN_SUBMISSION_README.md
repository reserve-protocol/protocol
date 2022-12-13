# Collateral Plugin - Morpho Compound

This document is a temporary file to accompany the source code changes in this Morpho Compound plugin gitcoin submission
pull request.

The plugins utilize EIP-4626 vaults recently deployed by morpho to represent shares in a Morpho compound
supply position. Direct Morpho supply positions are NFTs which can not be used as collateral, however by the using
EIP-4626 vault share tokens as the collateral token in the plugin, Morpho positions do work well with reserve.

The implementation uses two plugins, adaptions of the direct cToken fiat and non fiat plugins. Between the two they can
support all current morpho vaults. Because the underlying system used by the vaults are compound supply positions, the
plugins can largely share the strategy used by cToken plugins.

Morpho documents the vault interface here https://developers.morpho.xyz/interact-with-morpho/erc-4626-vaults .

All changes made fall under the greater licence in this repository, BlueOak-1.0.0.
discord handle: aaron#7674

## Accounting units

The collateral units held by reserve for these plugins are morpho compound tokens, mcTOK's. They are standard erc20s
representing shares in a Morpho supply position NFT. The reference and target units are dependent on the instance of the
plugin
similar to cToken plugins, for example the fiat plugin may use DAI as the reference and mcDAI as tok. The non fiat
plugin could use mcWBTC as tok, WBTC as reference, and BTC as target. In all cases the unit of account is USD.

## refPerTok movements

The refPerTok() return value is found from the convertToAssets() EIP-4626 method which gives the rate mcTOK shares can
be converted into the underlying asset. It can be trusted that the returned value will only increase because ultimately
it follows the same system as cTokens, it only goes up as mcTokens accrue interest from either the compound rates which
can only be positive, or the direct morpho rates which can only be higher.

## Implementation

Both MorphoFiatCollateral and MorphoNonFiatCollateral inherit Collateral and the ICollateral interface. The constructors
take the same parameters as their cToken counterparts. They still need to know about COMP and the comptroller as they're
used when claiming comp rewards.

The non fiat collateral uses two price feed oracles, one for the rate of the target in UoA and another for the rate
between target and ref. The target:ref can be used for something like a BTC:WBTC price feed, as in the non fiat test.
This allows a safety mechanism so wrapped tokens can be disabled after testing to see if the peg still holds.

The morpho vault tokens used as tok provide an interface to everything else required outside the plugin, like the
conversion rate to underlying, the underlying token, and the compound supply token for the underlying.

### strictPrice()

The strict price calculations did not require any changes from the cToken counterparts in both fiat and non fiat
versions.

### refresh()

Compared to the CToken counterparts the soft default test has been made more efficient. The default threshold is
instead the minimum value allowed for the relevant oracle feed which allows for a simpler and more efficient direct
comparison. To update compound the cToken is accessed through the mcTokens poolToken() function.

In the case that refPerTok ever returns a value lower than the previously read value the plugin will immediately hard
default and become disabled. There is no buffer, the implementations of cTokens and mcTokens mean this value should
never fall.

There is another gas optimisation to save ~94 gas during normal usage where the status result is unchanged from SOUND.
Instead of always overwriting the status and incurring a 100 gas fee for setting a slot to the same value, it compares
first to see if it has changed, adding a DUP and EQ instead at a cost of ~6 gas.

Slither reports two warnings in refresh. One has been kept as one it is the recommended pattern to use in the reserve
protocol solidity style document for catching out of gas errors. The other is an ignored return value which is also OK,
we don't use the eth/usd value to determine the status.

### refPerTok()

Returns the exchange rate for Morpho vault shares to underlying assets using the vaults convertToAssets() function in
uint192 fixed-point decimal value format. 1 ether is used as the input as all vault tokens use 18 decimals.

### pricePerTarget()

Returns the price feed from chainlink of UoA per target in the non fiat case.

### claimRewards()

Claiming comp rewards is performed through the morpho vault rather than directly through compound as reserve protocol
doesn't hold the cTokens and has mcTokens instead.The process is demonstrated in the fiat collateral test, but not in
the non fiat test as WBTC is not allocated comp rewards.

## Tests

Updating values used in the morpho vaults convertToAssets() requires a calling a state modifying function like
deposit(). In real world usage this would lead to frequent updates but in the tests a small deposit is made before
reading conversion rates. There is no update only method, making a change to a vault is required. This is enough to see
refPerTok increase as a result of the compound tokens earning interest.

Two integration tests have been added in test/integration/individual-collateral, MorphoFiatCollateral.test.ts and
MorphoNonFiatCollateral.test.ts. All 19 new tests are passing, they can be run with the script added to test only
the tests added with this submission with "yarn test:morpho".

The tests cover deployment, issuance/appreciation/redemption by updating each of the exchangeRate, oracles, and edge
cases relating to the price, status and oracles. The fiat test uses DAI, cDAI and mcDAI and claims comp rewards. The non
fiat test uses WBTC, cWBTC, mcWBTC and includes testing the plugin disables if the WBTC loses its peg to BTC.

## Deployment

Deployment parameters are demonstrated in the two tests. The value to use for defaultRelativeThreshold should be the
minimum value allowed for the ref oracle before soft defaulting as a value with 18 decimals, for example to default at
85% the value should be fp('0.85'). The following snippet demonstrates deploying the non fiat morpho plugin for the WBTC
vault with from an ethers script:

```typescript
    // Deploy mcWbtc collateral plugin
MorphoCollateralFactory = await ethers.getContractFactory('MorphoNonFiatCollateral', {
    libraries: {OracleLib: oracleLib.address},
})
mcWbtcCollateral = <MorphoNonFiatCollateral>(
    await MorphoCollateralFactory.deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.WBTC as string,
        networkConfig[chainId].chainlinkFeeds.BTC as string,
        mcWbtc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        wbtcDecimals,
        comptroller.address
    )
)
```
