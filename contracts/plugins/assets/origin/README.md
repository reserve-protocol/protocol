# Origin Wrapped SuperOETH Collateral Plugin

**NOTE: This version of the SuperOETH plugin assumes the price of `1 superOETH = 1 ETH`. This occurs because there is no reliable oracle feed for `superOETH` on Base. It also implies that depeg checks will not be performed for this plugin, and also that if for some reason this assumption breaks, the collateral will be priced incorrectly. Use with care and understanding the risks and limitations of the current design.**

## Summary

This plugin allows `wsuperOETH` holders on base to use their tokens as collateral in the Reserve Protocol.

`wsuperOETH` is an owned, upgradeable, ERC4626-wrapper around the `superOETH` token.

`wsuperOETH` collects the native `superOETH` yield.

`wsuperOETH` contract: <https://basescan.org/address/0x7fcd174e80f264448ebee8c88a7c4476aaf58ea6#code>

## Implementation

### Units

| tok        | ref       | target | UoA |
| ---------- | --------- | ------ | --- |
| wsuperOETH | superOETH | ETH    | USD |

### refPerTok()

Since `wsuperOETH` is an ERC4626 wrapper, the `refPerTok()` is straightforward: `wsuperOETH.convertToAssets(10 ** wsuperOETH.decimals())`

### claimRewards()

There are no rewards to claim from `wsuperOETH`, all yield is already included in the ERC4626 asset appreciation.
