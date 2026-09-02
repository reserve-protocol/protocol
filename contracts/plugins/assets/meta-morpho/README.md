# MetaMorpho

Morpho Blue is a permisionless lending protocol. At the time of this writing (March 19th, 2024), the only way to deposit is through something called **MetaMorpho**: (somewhat) managed ERC4626 vaults. Our integration with these tokens is straightforward with the exception of reward claiming, which occurs via supplying a merkle proof. This can be done permisionlessly and without interacting with any of our contracts, so any interaction with rewards is omitted here. The expectation is -- _and this is important to emphasize_ -- **any MORPHO reward claiming is left up to the RToken community to cause**. A [`MorphoAsset`](#morphoasset-reference-implementation----do-not-deploy) reference implementation exists for selling claimed MORPHO, but it is **not production ready and is not deployed** -- see that section.

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

## `MorphoAsset` (reference implementation -- DO NOT DEPLOY)

> **This plugin is not production ready and is intentionally not deployable.** There are no deployment or Etherscan verification scripts for it, and it is not referenced by `scripts/deploy.ts` or `scripts/verify_etherscan.ts`. It is kept in-tree as a reference implementation only. **Do not register it in an RToken's `AssetRegistry`.**

MORPHO is earned by holding MetaMorpho / Vault V2 collateral and is claimed off-chain. Claiming only moves it into the Backing Manager -- without a registered `Asset` the protocol has no price for it and cannot sell it. `MorphoAsset` was written to close that gap (an `Asset`, not a Collateral -- MORPHO is never backing and is only ever sold), pricing it as `{UoA/tok} = ETH/USD x TWAP(MORPHO/WETH)` over the Uniswap V3 0.30% pool `0xc8219b876753A85025156b22176c2eDEA17aAC53`, since Chainlink's MORPHO/USD feed exists only on Base.

It is not deployed for two reasons.

**1. The price source is cheaply manipulable.** All mainnet MORPHO liquidity totals ~$126k, and the deepest TWAP-capable venue holds only ~$62k. (Uniswap V4 holds a comparable share, but V4 moved its oracle into hooks and every MORPHO pool there is hookless, so V3 is the only TWAP-capable venue at all.) `docs/collateral.md` requires that an oracle not be manipulable _cheaply_; a 30-minute TWAP over a pool that thin does not clear that bar, even though it is not manipulable within a single block.

**2. `maxTradeVolume` does not bound true-value exposure -- it amplifies it.** `TradeLib.maxTradeSize()` sizes a lot as `maxTradeVolume / sellHigh`, denominated in this plugin's own reported price. Push the TWAP down by a factor `k` and the lot grows as `1/k`, so the true value sold grows as `1/k`, while the minimum proceeds are `maxTradeVolume * (1 - oracleError) * (1 - maxTradeSlippage) / (1 + oracleError)` -- **independent of `k`**. With $10k `maxTradeVolume`, 10% `oracleError` and 1% `maxTradeSlippage`, that floor is ~$8.1k whether the price is honest, halved, or down 10x; only the quantity of MORPHO handed over grows. The effective ceiling is the entire held balance. Revenue auctions are permissionless, so the same actor moves the TWAP and bids. No parameter value fixes this -- lowering `maxTradeVolume` scales both sides equally.

Every other plugin is safe here because its price bottoms out in a Chainlink feed a bidder cannot move, which is the assumption `TradeLib`'s sizing relies on. This is a plugin violating that precondition, not a flaw in `TradeLib`.

Shipping it would require sizing that does not depend on a manipulable price -- an oracle-independent cap on token quantity or aggregate exposure, or a price source meeting the "not cheaply manipulable" bar. Note that as of 2026-09 none of the eight Vault V2 vaults emit MORPHO, so nothing is currently forgone.

If it is ever revisited, one operational prerequisite: the pool's `observationCardinality` must retain `twapWindow` seconds of observations (`twapWindow / blockTime + 1` of them) or `observe()` reverts `OLD` and the asset becomes unpriced. Grow it permissionlessly with headroom via `increaseObservationCardinalityNext()`, well in advance.

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

[Morpho Vault V2](https://docs.morpho.org/learn/concepts/vault-v2/) fiat vaults use `MorphoV2FiatCollateral`, a thin subclass of `MetaMorphoFiatCollateral`. Pricing and default behavior are identical (V2 keeps the exact ERC-4626 surface — `convertToAssets`, `asset`, `decimals` — so `underlyingRefPerTok()` is unchanged); the subclass only adds a constructor guard on the vault's gates (see below). The V2-specific deviations were checked on-chain and found benign:

| Check               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ERC-4626 / 2612** | Compliant. 18-decimal share over a 6-decimal asset; `convertToAssets` accounts for fees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Gates**           | V2 adds optional gate contracts that can restrict share transfers / asset flows. The 3 critical gates (`receiveSharesGate`, `sendSharesGate`, `receiveAssetsGate`) could block the protocol (or any holder) from holding, trading, or exiting the collateral. `MorphoV2FiatCollateral`'s **constructor reverts** unless each is unset (`address(0)`) **and** its setter is abdicated (permanently disabled). Checked once at construction because abdication is permanent — no runtime check needed. `sendAssetsGate` is not required (it only gates future deposit/mint, not transfer or exit of existing shares). |
| **`max*` quirk**    | V2 `maxDeposit`/`maxMint`/`maxWithdraw`/`maxRedeem` always return 0. Harmless: the protocol holds and trades the share token and never calls `vault.redeem()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Fees & losses**   | Performance/management fees and adapter losses flow through `convertToAssets`. Routine fee dips are absorbed by `revenueHiding`; a genuine loss correctly DISABLES the collateral.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Mainnet vaults validated against the live chain (all gates unset; fees 0 except PayPal USD Main, which has a ~1%/yr management fee):

| Name                   | Symbol              | Address                                      | Asset |
| ---------------------- | ------------------- | -------------------------------------------- | ----- |
| Steakhouse Prime USDC  | steakUSDC           | `0xbeef088055857739C12CD3765F20b7679Def0f51` | USDC  |
| PayPal USD Main        | senPYUSDmain        | `0xb576765fB15505433aF24FEe2c0325895C559FB2` | PYUSD |
| Gauntlet USDC Frontier | gtusdcf             | `0x9a1D6bd5b8642C41F25e0958129B85f8E1176F3e` | USDC  |
| Steakhouse Prime USDT  | steakUSDT           | `0xbeef003C68896c7D2c3c60d363e8d71a49Ab2bf9` | USDT  |
| Galaxy USDT Quality    | gUSDTq              | `0x71ffB6a81786eC285D429d531Cf655107B9D878d` | USDT  |
| Gauntlet USDC Prime    | gtusdcp             | `0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0` | USDC  |
| Galaxy USDC Quality    | gUSDCq              | `0x91600E31fBeDc72433d4a57F16639cfe661Be7d8` | USDC  |
| Sky.money USDT Savings | skyMoneyUsdtSavings | `0x23f5E9c35820f4baB695Ac1F19c203cC3f8e1e11` | USDT  |

Reward claiming is unchanged from V1 (off-chain Merkle claim on behalf of the Backing Manager).

## Future Work

- Assets need to exist for each of the Reward Tokens, which requires oracles. USDC meets this bar and MORPHO is now covered by `MorphoAsset`; SWISE and BTRFLY still have no oracle.
- The right reward token assets need to be registered for an RToken as a function of their collateral. This can be done using the above table.
- `MorphoAsset` is mainnet-only; on Base a plain `Asset` against Chainlink's MORPHO/USD feed would do.
