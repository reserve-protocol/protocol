# MetaMorpho

Morpho Blue is a permisionless lending protocol. At the time of this writing (March 19th, 2024), the only way to deposit is through something called **MetaMorpho**: (somewhat) managed ERC4626 vaults. Our integration with these tokens is straightforward with the exception of reward claiming, which occurs via supplying a merkle proof. This can be done permisionlessly and without interacting with any of our contracts, so any interaction with rewards is omitted here. The expectation is -- _and this is important to emphasize_ -- **any MORPHO reward claiming is left up to the RToken community to cause**.

## Up-only-ness

MetaMorpho suffers from a similar to that of the Curve volatile pools which can lose assets on admin fee claim.

## Target tokens

**USD**
| Name | Symbol | Address | Reward Tokens |
| -- | -- | -- | -- |
| Steakhouse USDC | steakUSDC| 0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB | wstETH, MORPHO |
| Steakhouse PYSUD | steakPYUSD | 0xbEEF02e5E13584ab96848af90261f0C8Ee04722a | MORPHO |
| Flagship USDT | bbUSDT| 0x2C25f6C25770fFEC5959D34B94Bf898865e5D6b1 | MORPHO |

**ETH**

| Name     | Symbol  | Address                                    | Reward Tokens               |
| -------- | ------- | ------------------------------------------ | --------------------------- |
| Re7 WETH | Re7WETH | 0x78Fc2c2eD1A4cDb5402365934aE5648aDAd094d0 | USDC, SWISE, BTRFLY, MORPHO |

## Future Work

- Assets need to exist for each of the Reward Tokens, which requires oracles. Only USDC meets this bar; SWISE, BTRFLY, and MORPHO do not have oracles yet.
- The right reward token assets need to be registered for an RToken as a function of their collateral. This can be done using the above table.
