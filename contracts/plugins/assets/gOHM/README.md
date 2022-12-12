# gOHM Collateral Plugin

## Summary

This plugin allows `gOHM` holders use their tokens as collateral in the Reverse Protocol.

As described in the [Olympus Site](https://docs.olympusdao.finance/main/overview/staking) , `gOHM` staking token on Olympus.

`gOHM` will accrue revenue from **staking rewards** into itself by **increasing** the exchange rate of the `gOHM` per `OHM`. The exchange rate in the Olympus called `index`.

You can get exchange rate from [`gOHM.index()`](https://etherscan.io/address/0x0ab87046fbb341d058f17cbc4c1133f25a20a52f/advanced#readContract#F11).

`gOHM` contract: <https://etherscan.io/token/0x0ab87046fbb341d058f17cbc4c1133f25a20a52f>

`OHM` contract: <https://etherscan.io/token/0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5>

### What is Olympus Protocol?

> Olympus is a protocol on the Ethereum blockchain with the goal of establishing OHM as a crypto-native reserve currency. It conducts autonomous and dynamic monetary policy, with market operations supported by the protocol-owned Olympus Treasury.

_\*from [Olympus docs](https://docs.olympusdao.finance/main/overview/intro)_

### gOHM

> OHM holders can choose to stake OHM for gOHM, which receives the Base Staking Rate (“BSR”). During Olympus’ bootstrapping phase, this rate was intended to reflect the expected growth of the network. The BSR now serves as a demand driver for OHM as well as a reference rate against which productive economic activity (lending, liquidity provision, etc.) is measured. Furthermore, it acts as a foundation for OHM bonds to develop a yield curve across different expiries.

_\*from [Olympus docs](https://docs.olympusdao.finance/main/overview/staking)_

## Economics

Holding `gOHM` has a economic advantage over holding `OHM`, because **Staking Rewards** accumulates into the protocol and causes `gOHM` go up against `OHM`.

Rewards for holding `gOHM` is calculated by an exchange rate (`index`):

```
gOHM = OHM * Index
```

**Index is non-decreasing over time, so this rate is a good candidate for `{ref/tok}`.**

_\*from [Olympus docs](https://docs.olympusdao.finance/main/overview/staking)_

## Implementation

### Units

| tok  | ref | target | UoA |
| ---- | --- | ------ | --- |
| gOHM | OHM | OHM    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns rate of `OHM/gOHM`, getting from [`gOHM.index()`](https://etherscan.io/address/0x0ab87046fbb341d058f17cbc4c1133f25a20a52f/advanced#readContract#F11) function in `gOHM` contract.

`gOHM.index()` method returns a D9{ref/tok} and `refPerTok()` will convert it to D18{ref/tok}

#### strictPrice() {UoA/tok}

Because there is no price feed for `{USD/gOHM}`, we calculating the price as follow:

```
{UoA/tok} = {UoA/target} * {target/ref}
{USD/gOHM} = {USD/OHM} * {OHM/gOHM}
```

- `{USD/OHM}`: From `targetPerRef()`
- `{OHM/gOHM}`: From `refPerTok()`

#### targetPerRef() {target/ref}

Always returns `1` since `target` and `ref` are both `OHM`.

#### refresh()

This function will check the conditions and update status if needed. Conditions are as below:

- Reference price decrease: This will `default` collateral **immediately** and status became `DISABLED`
- `strictPrice` reverts: Collateral status becomes `IFFY`
- `pricePerTarget` reverts: Collateral status becomes `IFFY`

#### pricePerTarget() {UoA/target}

Because there is no price feed for `USD/OHM`, this plugin uses this calculation:

```
{USD/OHM} = {ETH/OHM} * {USD/ETH}
```

`{ETH/OHM}`: [chainlink feed](https://data.chain.link/ethereum/mainnet/crypto-eth/ohmv2-eth)

`{USD/ETH}`: [chainlink feed](https://data.chain.link/ethereum/mainnet/crypto-usd/eth-usd)

#### targetName()

returns `OHM`

#### isCollateral()

returns True.

### claimRewards()

Does nothing.

## Deployment

- Deployment [task](../../../../tasks/deployment/collateral/deploy-gohm-collateral.ts):

  - `yarn hardhat deploy-gohm-collateral`
  - Params:
    - `fallback-price`: A fallback price (in UoA)
    - `ohm-eth-price-feed`: ETH/OHM Price Feed address
    - `eth-usd-price-feed`: ETH/USD Price Feed address
    - `token-address`: gOHM address
    - `max-trade-volume`: Max Trade Volume (in UoA)
    - `oracle-timeout`: Max oracle timeout
    - `target-name`: Target Name
    - `delay-until-default`: Seconds until default
    - `decimals`: Reference token decimals

  Example:

  ```sh
  yarn hardhat deploy-gohm-collateral \
    --fallback-price 2400000000000000000000 `# 2400$ * 10**18` \
    --ohm-eth-price-feed 0x9a72298ae3886221820b1c878d12d872087d3a23 \
    --eth-usd-price-feed 0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419 \
    --token-address 0x0ab87046fBb341D058F17CBC4c1133F25a20a52f \
    --max-trade-volume 1000000 `# 1M$` \
    --oracle-timeout 86400 `# 24H` \
    --target-name OHM \
    --delay-until-default 86400 `# 24H` \
    --decimals 9 # OHM Decimals
  ```

## Testing

- Integration Test:

  - File: [test/integration/individual-collateral/GOhmCollateral.test.ts](../../../../test/integration/individual-collateral/GOhmCollateral.test.ts)
  - Run: `yarn test:integration`
