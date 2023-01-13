# Reserve Protocol

The Reserve Protocol enables a class of token called RToken: self-issued tokens backed by a rebalancing basket of collateral. While the protocol enables any number of RTokens to be created, further discussion is limited to the characterization of a single RToken instance.

## Overview

RTokens can be minted by depositing a basket of _collateral tokens_, and redeemed for the basket as well. Thus, an RToken will tend to trade at the market value of the entire basket that backs it, as any lower or higher price could be arbitraged.

The definition of the collateral basket is set dynamically on a block-by-block basis with respect to a _reference basket_. While the RToken often does its internal calculus in terms of a single unit of account (USD), what constitutes appreciation is entirely a function of the reference basket.

RTokens can be over-collateralized, which means that if any of their collateral tokens default, there's a pool of value available to make up for the loss. RToken over-collateralization is provided by Reserve Rights (RSR) holders, who may choose to stake their RSR on an RToken instance. Staked RSR can be seized in the case of a default, in a process that is entirely mechanistic based on on-chain price-feeds, and does not depend on governance votes or human judgment.

But markets do not over-collateralize holders for free. In order to incentivize RSR holders to stake in an RToken instance, each RToken instance can choose to offer an arbitrary portion of its revenue to be directed towards its RSR over-collateralization pool. This simultaneously encourages staking in order to provision an over-collateralization buffer, while increasing the size of that buffer over time.

As with any smart contract application, the actual behavior may vary from the intended behavior. It's safest to observe an application in use for a long period of time before trusting it to behave as expected. This overview describes its _intended_ behavior.

For a much more detailed explanation of the economic design, including an hour-long explainer video (!) see [the Reserve website](https://reserve.org/protocol/2021_version/).

## Further Documentation

- [Development Environment](docs/dev-env.md): Setup and usage of our dev environment. How to compile, autoformat, lint, and test our code.
  - [Testing with Echidna](docs/using-echidna.md): Notes so far on setup and usage of Echidna (which is decidedly an integration-in-progress!)
  - [Deployment](docs/deployment.md): How to do test deployments in our environment.
- [System Design](docs/system-design.md): The overall architecture of our system, and some detailed descriptions about what our protocol is _intended_ to do.
- [Our Solidity Style](docs/solidity-style.md): Common practices, details, and conventions relevant to reading and writing our Solidity source code, estpecially where those go beyond standard practice.
- [Writing Collateral Plugins](docs/collateral.md): An overview of how to develop collateral plugins and the concepts / questions involved.
- [MEV](docs/mev.md): A resource for MEV searchers and others looking to interact with the deployed protocol programatically.
- [Changelog](CHANGELOG.md): Release changelog

## Mainnet Addresses (v1.1.0)

| Implementation Contracts | Address                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| rewardableLib            | [0xe1C1Af81Aa2E6f978fa05532A3588e3b1E703B78](https://etherscan.io/address/0xe1C1Af81Aa2E6f978fa05532A3588e3b1E703B78) |
| tradingLib               | [0xB8794Fb1CCd62bFe631293163F4A3fC2d22e37e0](https://etherscan.io/address/0xB8794Fb1CCd62bFe631293163F4A3fC2d22e37e0) |
| permitLib                | [0x3E40840d0282C9F9cC7d17094b5239f87fcf18e5](https://etherscan.io/address/0x3E40840d0282C9F9cC7d17094b5239f87fcf18e5) |
| oracleLib                | [0x89c34D34538Fd8a19C4D2e288c766147043D2694](https://etherscan.io/address/0x89c34D34538Fd8a19C4D2e288c766147043D2694) |
| facadeRead               | [0x42A928f406484422ECE2653Ccd13A52CD3FE0ED9](https://etherscan.io/address/0x42A928f406484422ECE2653Ccd13A52CD3FE0ED9) |
| facadeAct                | [0x348644F24FA34c40a8E3C4Cf9aF14f8a96aD63fC](https://etherscan.io/address/0x348644F24FA34c40a8E3C4Cf9aF14f8a96aD63fC) |
| facadeWriteLib           | [0x82dFC8C58Ed8f105eBf68F0C5639cc8c1Ca3c656](https://etherscan.io/address/0x82dFC8C58Ed8f105eBf68F0C5639cc8c1Ca3c656) |
| facadeWrite              | [0xEE527CC63122732532d0f1ad33Ec035D30f3050f](https://etherscan.io/address/0xEE527CC63122732532d0f1ad33Ec035D30f3050f) |
| deployer                 | [0x0F345F57ee2b395e23390f8e1F1869D7E6C0F70e](https://etherscan.io/address/0x0F345F57ee2b395e23390f8e1F1869D7E6C0F70e) |
| rsrAsset                 | [0x6F6f81e5E66f503184f2202D83a79650c3285759](https://etherscan.io/address/0x6F6f81e5E66f503184f2202D83a79650c3285759) |
| main                     | [0xaa85216187F92a781D8F9Bcb40825E356ee2635a](https://etherscan.io/address/0xaa85216187F92a781D8F9Bcb40825E356ee2635a) |
| trade                    | [0x2D1A824F6b347372ebe1AF3dAa840487e701B697](https://etherscan.io/address/0x2D1A824F6b347372ebe1AF3dAa840487e701B697) |
| assetRegistry            | [0xD126741474B0348D9B0F4911573d8f543c01C2c4](https://etherscan.io/address/0xD126741474B0348D9B0F4911573d8f543c01C2c4) |
| backingManager           | [0x2cE0f5bAb6a911e153A0C09d407b6EFCc336DFB4](https://etherscan.io/address/0x2cE0f5bAb6a911e153A0C09d407b6EFCc336DFB4) |
| basketHandler            | [0x073BD162BBD05Cd2CF631B90D44239B8a367276e](https://etherscan.io/address/0x073BD162BBD05Cd2CF631B90D44239B8a367276e) |
| broker                   | [0x52b894A9D1cb7E5245Fd7bAdfb691de6f1f03836](https://etherscan.io/address/0x52b894A9D1cb7E5245Fd7bAdfb691de6f1f03836) |
| distributor              | [0x851B461a9744f4c9E996C03072cAB6f44Fa04d0D](https://etherscan.io/address/0x851B461a9744f4c9E996C03072cAB6f44Fa04d0D) |
| furnace                  | [0xbcf5810336825380ffb4e5E680bb693007F2b1e6](https://etherscan.io/address/0xbcf5810336825380ffb4e5E680bb693007F2b1e6) |
| rsrTrader/rTokenTrader   | [0x65D41084B9c3FF3dcf911542DD28b1ec3d6d6eb6](https://etherscan.io/address/0x65D41084B9c3FF3dcf911542DD28b1ec3d6d6eb6) |
| rToken                   | [0x5e0116B2b2724B3520bEb9C9928cda84F4129715](https://etherscan.io/address/0x5e0116B2b2724B3520bEb9C9928cda84F4129715) |
| stRSR                    | [0x2B5Ca65E7e423b36F7b185B4E116A6Fd0E6C4Ce2](https://etherscan.io/address/0x2B5Ca65E7e423b36F7b185B4E116A6Fd0E6C4Ce2) |

The DeployerRegistry, which contains a link to all official releases via their Deployer contracts, can be found [here](https://etherscan.io/address/0xD85Fac03804a3e44D29c494f3761D11A2262cBBe).

## Parallel Prototypes

We have a `p0` and `p1` implementation for each contract in our core system. The `p0` version is our _specification_ prototype, and is intended to be as easy as possible to understand. The `p1` version should behave identically, except that it employs substantial optimizations and more complicated algorithms in order to achieve lower gas costs.

We implement and maintain both of these systems in the name of correctness. Implementing p0 helps us to specify the exact intended behavior of the protocol without needing to deal simultaneously with gas optimization; maintaining equivalent behavior of both serves as a substantial extra form of testing. The behavior of each contract in `p1` should be _identical_ to the behavior of the corresponding contract in `p0`, so we can perform [differential testing](https://en.wikipedia.org/wiki/Differential_testing) between them - checking that they behave identicially, both in our explicit tests and in arbitrary randomized tests.

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
  - Caveat: a function might be _O(k)_, where _k_ is the number of registered Assets or Collateral tokens; however, we take great care to make those loops efficient, and to avoid _O(k^2)_ behvior!
- No user is ever forced to pay gas to process other users' transactions.

## Repository Structure

`contracts` holds our smart contracts:

- `p0` and `p1` each contain an entire implementations of our core protocol. `p0` is as easy as possible to understand; `p1` is our gas-efficient system to deploy in production.
- The core protocol requires a plugin contract for each asset it handles and each auction platform it can use. `plugins` contains our initial implementations of these (`plugins/assets`, `plugins/markets`), as well as mock implementations of each asset and auction platform that we're using for testing purposes (`plugins/mocks`).
- `interfaces` contains the contract interfaces for all of those implementations.

`test` holds our Typescript system tests, driven through Hardhat.

The less-central folders in the repository are dedicated to project management, configuration, and other ancillary details:

- Most of the top-level files are various forms of project-level configuration
- `common`: Shared utility types, methods, and constants for testing in TypeScript
- `tasks`: [Hardhat tasks](https://hardhat.org/getting-started/)
- `scripts`: [Hardhat scripts](https://hardhat.org/guides/scripts.html)
- `types`: Typescript annotations; currently just `export interface Address {}`

## Types of Tests

We conceive of several different types of tests:

Finally, inside particular testing, it's quite useful to distinguish unit tests from full end-to-end tests. As such, we expect to write tests of the following 5 types:

### Unit/System Tests

- Driven by `hardhat test`
- Checks for expected behavior of the system.
- Can run the same tests against both p0 and p1
- Uses contract mocks, where helpful to predict component behavior

Target: Full branch coverage, and testing of any semantically-relevant situations

### End-to-End Tests

- Driven by `hardhat test`
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
- Unless the protocol is paused, RToken holders can always redeem
- If the protocol is paused, and governance does not act further, the protocol will later become unpaused.

### Differential Testing

Located in `fuzz` branch only.

- Driven by Echidna
- Asserts that the behavior of each p1 contract matches that of p0

Target: Intensive equivalence testing, run continuously for days or weeks, sensitive to any difference between observable behaviors of p0 and p1.

## Contributing

If you would like to contribute, you'll need to configure a secret in your fork repo in order for our integration tests to pass in CI. The name of the secret should `ALCHEMY_MAINNET_KEY` and it should be equal to the suffix portion of the full URL.

Usage: `https://eth-mainnet.alchemyapi.io/v2/${{ secrets.ALCHEMY_MAINNET_KEY }}`

## External Documentation

[Video overview](https://youtu.be/341MhkOWsJE)
