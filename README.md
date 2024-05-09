# Reserve Protocol

The Reserve Protocol enables a class of token called RToken: self-issued tokens backed by a rebalancing basket of collateral. While the protocol enables any number of RTokens to be created, further discussion is limited to the characterization of a single RToken instance.

## Overview

RTokens can be minted by depositing a basket of _collateral tokens_, and redeemed for the basket as well. Thus, an RToken will tend to trade at the market value of the entire basket that backs it, as any lower or higher price could be arbitraged.

The definition of the issuance/redemption basket is set dynamically on a block-by-block basis with respect to a _reference basket_. While the RToken often does its internal calculus in terms of a single unit of account (USD), what constitutes appreciation is entirely a function of the reference basket, which is a linear combination of reference units.

RTokens can be over-collateralized, which means that if any of their collateral tokens default, there's a pool of value available to make up for the loss. RToken over-collateralization is provided by Reserve Rights (RSR) holders, who may choose to stake their RSR on an RToken instance. Staked RSR can be seized in the case of a default, in a process that is entirely mechanistic based on on-chain price-feeds, and does not depend on governance votes or human judgment.

But markets do not over-collateralize holders for free. In order to incentivize RSR holders to stake in an RToken instance, each RToken instance can choose to offer an arbitrary portion of its revenue to be directed towards its RSR over-collateralization pool. This encourages staking in order to provision over-collateralization.

As with any smart contract application, the actual behavior may vary from the intended behavior. It's safest to observe an application in use for a long period of time before trusting it to behave as expected. This overview describes its _intended_ behavior.

For a much more detailed explanation of the economic design, including an hour-long explainer video (!) see [the Reserve website](https://reserve.org/protocol/2021_version/).

## Further Documentation

- [Development Environment](https://github.com/reserve-protocol/protocol/blob/master/docs/dev-env.md): Setup and usage of our dev environment. How to compile, autoformat, lint, and test our code.
  - [Testing with Echidna](https://github.com/reserve-protocol/protocol/blob/master/docs/using-echidna.md): Notes so far on setup and usage of Echidna (which is decidedly an integration-in-progress!)
  - [Deployment](https://github.com/reserve-protocol/protocol/blob/master/docs/deployment.md): How to do test deployments in our environment.
- [System Design](https://github.com/reserve-protocol/protocol/blob/master/docs/system-design.md): The overall architecture of our system, and some detailed descriptions about what our protocol is _intended_ to do.
- [Pause and Freeze States](https://github.com/reserve-protocol/protocol/blob/master/docs/pause-freeze-states.md): An overview of which protocol functions are halted in the paused and frozen states.
- [Deployment Variables](https://github.com/reserve-protocol/protocol/blob/master/docs/deployment-variables.md) A detailed description of the governance variables of the protocol.
- [Our Solidity Style](https://github.com/reserve-protocol/protocol/blob/master/docs/solidity-style.md): Common practices, details, and conventions relevant to reading and writing our Solidity source code, especially where those go beyond standard practice.
- [Writing Collateral Plugins](https://github.com/reserve-protocol/protocol/blob/master/docs/collateral.md): An overview of how to develop collateral plugins and the concepts / questions involved.
- [Building on Top](https://github.com/reserve-protocol/protocol/blob/master/docs/build-on-top.md): How to build on top of Reserve, including information about long-lived fork environments.
- [MEV](https://github.com/reserve-protocol/protocol/blob/master/docs/mev.md): A resource for MEV searchers and others looking to interact with the deployed protocol programmatically.
- [Rebalancing Algorithm](https://github.com/reserve-protocol/protocol/blob/master/docs/recollateralization.md): Description of our trading algorithm during the recollateralization process
- [Changelog](https://github.com/reserve-protocol/protocol/blob/master/CHANGELOG.md): Release changelog

## Mainnet Addresses (v3.4.0)

| Implementation Contracts | Address                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| tradingLib               | [0xa54544C6C36C0d776cc4F04EBB847e0BB3A11ea2](https://etherscan.io/address/0xa54544C6C36C0d776cc4F04EBB847e0BB3A11ea2) |
| facade                   | [0x2C7ca56342177343A2954C250702Fd464f4d0613](https://etherscan.io/address/0x2C7ca56342177343A2954C250702Fd464f4d0613) |
| facadeWriteLib           | [0xDf73Cd789422040182b0C24a8b2C97bbCbba3263](https://etherscan.io/address/0xDf73Cd789422040182b0C24a8b2C97bbCbba3263) |
| facadeWrite              | [0x1D94290F82D0B417B088d9F5dB316B11C9cf220C](https://etherscan.io/address/0x1D94290F82D0B417B088d9F5dB316B11C9cf220C) |
| deployer                 | [0x2204EC97D31E2C9eE62eaD9e6E2d5F7712D3f1bF](https://etherscan.io/address/0x2204EC97D31E2C9eE62eaD9e6E2d5F7712D3f1bF) |
| rsrAsset                 | [0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA](https://etherscan.io/address/0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA) |
| main                     | [0x24a4B37F9c40fB0E80ec436Df2e9989FBAFa8bB7](https://etherscan.io/address/0x24a4B37F9c40fB0E80ec436Df2e9989FBAFa8bB7) |
| gnosisTrade              | [0x030c9B66Ac089cB01aA2058FC8f7d9baddC9ae75](https://etherscan.io/address/0x030c9B66Ac089cB01aA2058FC8f7d9baddC9ae75) |
| dutchTrade               | [0x971c890ACb9EeB084f292996Be667bB9A2889AE9](https://etherscan.io/address/0x971c890ACb9EeB084f292996Be667bB9A2889AE9) |
| assetRegistry            | [0xbF1C0206de440b2cF76Ea4405e1DbF2fC227a463](https://etherscan.io/address/0xbF1C0206de440b2cF76Ea4405e1DbF2fC227a463) |
| backingManager           | [0x20C801869e578E71F2298649870765Aa81f7DC69](https://etherscan.io/address/0x20C801869e578E71F2298649870765Aa81f7DC69) |
| basketHandler            | [0xeE7FC703f84AE2CE30475333c57E56d3A7D3AdBC](https://etherscan.io/address/0xeE7FC703f84AE2CE30475333c57E56d3A7D3AdBC) |
| broker                   | [0x62BD44b05542bfF1E59A01Bf7151F533e1c9C12c](https://etherscan.io/address/0x62BD44b05542bfF1E59A01Bf7151F533e1c9C12c) |
| distributor              | [0x44a42A0F14128E81a21c5fc4322a9f91fF83b4Ee](https://etherscan.io/address/0x44a42A0F14128E81a21c5fc4322a9f91fF83b4Ee) |
| furnace                  | [0x845B8b0a1c6DB8318414d708Da25fA28d4a0dc81](https://etherscan.io/address/0x845B8b0a1c6DB8318414d708Da25fA28d4a0dc81) |
| rsrTrader                | [0xc60a7Cd6fce24d0c3637A1dCBC8B0f9A9BFF6a7c](https://etherscan.io/address/0xc60a7Cd6fce24d0c3637A1dCBC8B0f9A9BFF6a7c) |
| rTokenTrader             | [0xc60a7Cd6fce24d0c3637A1dCBC8B0f9A9BFF6a7c](https://etherscan.io/address/0xc60a7Cd6fce24d0c3637A1dCBC8B0f9A9BFF6a7c) |
| rToken                   | [0x784955641292b0014BC9eF82321300f0b6C7E36d](https://etherscan.io/address/0x784955641292b0014BC9eF82321300f0b6C7E36d) |
| stRSR                    | [0xE433673648c94FEC0706E5AC95d4f4097f58B5fb](https://etherscan.io/address/0xE433673648c94FEC0706E5AC95d4f4097f58B5fb) |

The DeployerRegistry, which contains a link to all official releases via their Deployer contracts, can be found [here](https://etherscan.io/address/0xD85Fac03804a3e44D29c494f3761D11A2262cBBe).

Deployed collateral plugin addresses and their configuration parameters can be found [here](https://github.com/reserve-protocol/protocol/blob/master/docs/plugin-addresses.md).

## Parallel Prototypes

We have a `p0` and `p1` implementation for each contract in our core system. The `p0` version is our _specification_ prototype, and is intended to be as easy as possible to understand. The `p1` version should behave identically, except that it employs substantial optimizations and more complicated algorithms in order to achieve lower gas costs.

We implement and maintain both of these systems in the name of correctness. Implementing p0 helps us to specify the exact intended behavior of the protocol without needing to deal simultaneously with gas optimization; maintaining equivalent behavior of both serves as a substantial extra form of testing. The behavior of each contract in `p1` should be _identical_ to the behavior of the corresponding contract in `p0`, so we can perform [differential testing](https://en.wikipedia.org/wiki/Differential_testing) between them - checking that they behave identically, both in our explicit tests and in arbitrary randomized tests.

We thought `p0` and `p1` would end up being a lot more different than they ended up being. For the most part the contracts only really differ for `StRSR.sol`, and a little for `RToken.sol`.

### Properties of P0

P0 implements our "abstract" economic protocol; it should have equivalent observable behavior to P1, but be expressed just as clearly as we can manage it in Solidity. In several places, we achieve that clarity by forgoing any attempt to be realistic to deploy to Ethereum.

- Optimized for _obviousness_ and _clarity of expression_
- No constraints on execution speed or gas costs
- State is fully normalized whenever practical

### Properties of P1

P1 is the production version of the economic protocol.

- Upgradable
- Optimized for gas costs
- No function call needs more than _O(lg N)_ time or space, and it's _O(1)_ where possible.
  - Caveat: a function might be _O(k)_, where _k_ is the number of registered Assets or Collateral tokens; however, we take great care to make those loops efficient, and to avoid _O(k^2)_ behavior!
- No user is ever forced to pay gas to process other users' transactions.

## Repository Structure

`contracts` holds our smart contracts:

- `p0` and `p1` each contain an entire implementations of our core protocol. `p0` is as easy as possible to understand; `p1` is our gas-efficient system to deploy in production.
- The core protocol requires a plugin contract for each asset it handles and each auction platform it can use. `plugins` contains our initial implementations of these (`plugins/assets`, `plugins/trading`), as well as mock implementations of each asset and auction platform that we're using for testing purposes (`plugins/mocks`).
- `interfaces` contains the contract interfaces for all of those implementations.

`test` holds our Typescript system tests, driven through Hardhat.

The less-central folders in the repository are dedicated to project management, configuration, and other ancillary details:

- Most of the top-level files are various forms of project-level configuration
- `common`: Shared utility types, methods, and constants for testing in TypeScript
- `tasks`: [Hardhat tasks](https://hardhat.org/getting-started/)
- `scripts`: [Hardhat scripts](https://hardhat.org/guides/scripts.html)
- `types`: Typescript annotations; currently just `export interface Address {}`

## Types of Tests

### Unit/System Tests

- Driven by `hardhat test`
- Addressed by `yarn test:unit`
- Checks for expected behavior of the system.
- Can run the same tests against both p0 and p1
- Uses contract mocks, where helpful to predict component behavior

Target: Full branch coverage, and testing of any semantically-relevant situations

### End-to-End Tests

- Driven by `hardhat test`
- Addressed by `yarn test:integration`
- Uses mainnet forking
- Can run the same tests against both p0 and p1
- Tests all needed plugin contracts, contract deployment, any migrations, etc.
- Mock out as little as possible; use instances of real contracts

Target: Each integration we plan to deploy behaves correctly under all actually-anticipated scenarios.

### Property Testing

Located in `fuzz` branch only.

- Driven by Echidna
- Asserts that contract invariants and functional properties of contract implementations hold for many executions
- Particular tests may be either particular to p0, particular to p1, or generic across both (by relying only on their common interface)

Target: The handful of our most depended-upon system properties and invariants are articulated and thoroughly fuzz-tested. Examples of such properties include:

- Unless the basket is switched (due to token default or governance) the protocol always remains fully-collateralized.
- Unless the protocol is frozen, RToken holders can always redeem

## Contributing

If you would like to contribute, you'll need to configure a secret in your fork repo in order for our integration tests to pass in CI. The name of the secret should `ALCHEMY_MAINNET_KEY` and it should be equal to the suffix portion of the full URL.

Usage: `https://eth-mainnet.alchemyapi.io/v2/${{ secrets.ALCHEMY_MAINNET_KEY }}`

To get setup with tenderly, install the [tenderly cli](https://github.com/Tenderly/tenderly-cli). and login with `tenderly login --authentication-method access-key --access-key {your_access_key} --force`.

## Responsible Disclosure

See: [Immunefi](https://immunefi.com/bounty/reserve/)

## External Documentation

[Video overview](https://youtu.be/341MhkOWsJE)
