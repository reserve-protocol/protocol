# MetaMorpho

Morpho Blue is a permisionless lending protocol. At the time of this writing (March 19th, 2024), the only way to deposit is through something called **MetaMorpho**: (somewhat) managed ERC4626 vaults. Our integration with these tokens is straightforward with the exception of reward claiming, which occurs via supplying a merkle proof. This can be done permisionlessly and without interacting with any of our contracts, so any interaction with rewards is omitted here. The expectation is -- _and this is important to emphasize_ -- **any MORPHO reward claiming is left up to the RToken community to cause**.

## Up-only-ness

MetaMorpho suffers from a similar to that of the Curve volatile pools which can lose assets on admin fee claim.

## Reward claiming

Rewards can be claimed permissionlessly by anyone from off-chain, following the Morpho docs:

- Rewards concept: https://docs.morpho.org/learn/concepts/rewards/
- Claiming via the Morpho app: https://help.morpho.org/en/articles/12032660-rewards-on-the-morpho-app

It requires the following steps (see https://help.morpho.org/en/articles/12032660-rewards-on-the-morpho-app for a step-by-step walkthrough):

1. Querying the rewards for the holder address via the Morpho rewards portals: https://rewards-legacy.morpho.org/ and https://campaigns.morpho.org/
2. Retrieving the distributor contract and sending a transaction to `claim()` the rewards with the following parameters (all obtained from the previous call):
   - `account`: the holder address
   - `reward`: the address of the reward token
   - `claimable`: the amount of reward tokens to claim
   - `proof`: the merkle proof

It is important to note that in the case of Rtokens, rewards will need to be claimed on behalf of the Backing Manager.

## Target tokens

**USD**
| Name | Symbol | Address | Reward Tokens |
| -- | -- | -- | -- |
| Steakhouse USDC | steakUSDC| 0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB | wstETH, MORPHO |
| Steakhouse PYSUD | steakPYUSD | 0xbEEF02e5E13584ab96848af90261f0C8Ee04722a | MORPHO |
| Flagship USDT | bbUSDT| 0x2C25f6C25770fFEC5959D34B94Bf898865e5D6b1 | MORPHO |
| Morpho eUSD (Base) | meUSD | 0xbb819D845b573B5D7C538F5b85057160cfb5f313 | MORPHO |

**ETH**

| Name     | Symbol  | Address                                    | Reward Tokens               |
| -------- | ------- | ------------------------------------------ | --------------------------- |
| Re7 WETH | Re7WETH | 0x78Fc2c2eD1A4cDb5402365934aE5648aDAd094d0 | USDC, SWISE, BTRFLY, MORPHO |

## Morpho Vault V2

The same `MetaMorphoFiatCollateral` / `MetaMorphoSelfReferentialCollateral` contracts are reused, unchanged, for [Morpho Vault V2](https://docs.morpho.org/learn/concepts/vault-v2/) vaults. V2 keeps the exact ERC-4626 surface these plugins depend on (`convertToAssets`, `asset`, `decimals`), so `underlyingRefPerTok()` is correct without modification. The V2-specific deviations were checked on-chain and found benign:

| Check               | Result                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ERC-4626 / 2612** | Compliant. 18-decimal share over a 6-decimal asset; `convertToAssets` accounts for fees.                                                                                                                             |
| **Gates**           | V2 adds optional transfer/deposit/withdraw gate contracts. A share-transfer gate would block the protocol from holding/trading the collateral. **Every target vault must have all four gates unset (`address(0)`).** |
| **`max*` quirk**    | V2 `maxDeposit`/`maxMint`/`maxWithdraw`/`maxRedeem` always return 0. Harmless: the protocol holds and trades the share token and never calls `vault.redeem()`.                                                       |
| **Fees & losses**   | Performance/management fees and adapter losses flow through `convertToAssets`. Routine fee dips are absorbed by `revenueHiding`; a genuine loss correctly DISABLES the collateral.                                   |

Mainnet vaults validated against the live chain (all gates unset; fees 0 except Sentora PYUSD at 15% performance fee):

| Name                   | Symbol              | Address                                      | Asset |
| ---------------------- | ------------------- | -------------------------------------------- | ----- |
| Steakhouse Prime USDC  | steakUSDC           | `0xbeef088055857739C12CD3765F20b7679Def0f51` | USDC  |
| Sentora PYUSD Main     | senPYUSDPRIMEv2     | `0xC21b08C16458202593D4D9B26b9984Ee67b38BbD` | PYUSD |
| Gauntlet USDC Frontier | gtusdcf             | `0x9a1D6bd5b8642C41F25e0958129B85f8E1176F3e` | USDC  |
| Steakhouse Prime USDT  | steakUSDT           | `0xbeef003C68896c7D2c3c60d363e8d71a49Ab2bf9` | USDT  |
| Galaxy USDT Quality    | gUSDTq              | `0x71ffB6a81786eC285D429d531Cf655107B9D878d` | USDT  |
| Gauntlet USDC Prime    | gtusdcp             | `0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0` | USDC  |
| Galaxy USDC Quality    | gUSDCq              | `0x91600E31fBeDc72433d4a57F16639cfe661Be7d8` | USDC  |
| Sky.money USDT Savings | skyMoneyUsdtSavings | `0x23f5E9c35820f4baB695Ac1F19c203cC3f8e1e11` | USDT  |

Reward claiming is unchanged from V1 (off-chain Merkle claim on behalf of the Backing Manager).

## Future Work

- Assets need to exist for each of the Reward Tokens, which requires oracles. Only USDC meets this bar; SWISE, BTRFLY, and MORPHO do not have oracles yet.
- The right reward token assets need to be registered for an RToken as a function of their collateral. This can be done using the above table.
