# Origin Wrapped OETH (Mainnet) and Wrapped SuperOETH (Base) Collateral Plugins

## Summary

This plugin allows `wOETH` (mainnet) and `wsuperOETH` (base) holders to use their tokens as collateral in the Reserve Protocol.

On mainnet:
`wOETH` is an owned, upgradeable, ERC4626-wrapper around the `OETH` token.

`wOETH` collects the native `OETH` yield.

`wOETH` contract: <https://etherscan.io/address/0xDcEe70654261AF21C44c093C300eD3Bb97b78192#code>

On base:
`wsuperOETH` is an owned, upgradeable, ERC4626-wrapper around the `superOETH` token.

`wsuperOETH` collects the native `superOETH` yield.

`wsuperOETH` contract: <https://basescan.org/address/0x7fcd174e80f264448ebee8c88a7c4476aaf58ea6#code>

**NOTE: This version of the SuperOETH plugin (Base) assumes the price of `1 superOETH = 1 ETH`. This occurs because there is no reliable oracle feed for `superOETH` on Base. It also implies that depeg checks will not be performed for this plugin, and also that if for some reason this assumption breaks, the collateral will be priced incorrectly. Use with care and understanding the risks and limitations of the current design.**

## Implementations

### Units

`wOETH` (mainnet)
| tok | ref | target | UoA |
| ---------- | --------- | ------ | --- |
| wOETH | OETH | ETH | USD |

`wsuperOETH` (base)
| tok | ref | target | UoA |
| ---------- | --------- | ------ | --- |
| wsuperOETH | superOETH | ETH | USD |

### refPerTok()

- Both `wOETH` and `wsuperOETH` are ERC4626 wrappers, the `refPerTok()` is straightforward:
  - `wOETH.convertToAssets(10 ** wOETH.decimals())`
  - `wsuperOETH.convertToAssets(10 ** wsuperOETH.decimals())`

### claimRewards()

There are no rewards to claim from `wOETH` and `wsuperOETH`, all yield is already included in the ERC4626 assets appreciation.
