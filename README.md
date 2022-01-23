# Reserve Protocol

The Reserve Protocol enables a class of token called RToken: self-issued tokens backed by a rebalancing basket of collateral. In V1, collateral is restricted to be monotonically increasing with respect to some measurable reference price. The units of this reference price are general, but in practice monotonically increasing exchange rates are often found between assets of the same reference unit. 

In V2 the protocol will be generalized to the full set of assets, each with respect to an arbitrary reference unit. [todo: link to V2 repo when it exists]

While the protocol enables any number of RTokens to be created, further discussion is limited to the characterization of a single RToken instance.

## Overview

RTokens can be minted by depositing a basket of *collateral tokens*, and redeemed for the basket as well. Thus, an RToken will tend to trade at the market value of the entire basket that backs it, as any lower or higher price could be arbitraged. 

The definition of the collateral basket is set dynamically on a block-by-block basis with respect to a *reference basket*. The reference basket differs primarily from the collateral basket in its units. For example, consider a USD/EURO hybrid basket consisting of equal parts cUSDC-measured-in-USD and cEURO-measured-in-EURO (when such a thing exists). While the RToken often does its internal calculus in terms of a single unit of account (USD), what constitutes appreciation is entirely a function of the reference basket.

RTokens can be insured, which means that if any of their collateral tokens default, there's a pool of value available to make up for the loss. RToken insurance is provided by Reserve Rights (RSR) holders, who may choose to stake their RSR on an RToken instance. Staked RSR can be seized in the case of a default, in a process that is entirely mechanistic based on on-chain price-feeds, and does not depend on governance votes or human judgment.

But markets do not allow for the possiblity of insurance without tradeoff. In order to incentevize RSR holders to stake in an RToken instance, each RToken instance can choose to offer an arbitrary portion of its revenue to be directed towards its RSR insurance pool. This simultaneously encourages staking in order to provision an insurance buffer, while increasing the size of that buffer over time.  

As with any smart contract application, the actual behavior may vary from the intended behavior, and it's safest to wait for an application to be in use for a long period of time before trusting it to behave as expected. This overview describes its _intended_ behavior.

For a much more detailed explanation of the economic design, see [the Reserve website](https://reserve.org/protocol/2021_version/). (Note: These docs are probably more up to date than the website, at least until the website is updated at mainnet launch.)

## Development

Developers: See setup and repository usage notes at [docs/developers.md](docs/developers.md).

## Repository Structure

The central directories in this repository are `contracts` and `test`.

`test` holds our Typescript tests driven through hardhat, falling into two broad categories: 
- `p0`, `p1`, `p2`: prototype-specific unit tests
- `generic`: general tests written against the common external interface shared by all prototypes

`contracts` holds all our smart contracts, organized as follows:

- Top-level files: These are common across implementations.
- `libraries`: Common `DELEGATECALL` libraries
- `p0`, `p1`, `p2`: Short for `proto`. [Progressive prototypes and differential testing](#differential_testing)
- `mocks`: Mock contracts for testing

Each implementation directory (`prod`, `p0`, `p1`, `p2`) contains the following:

- Top-level files: The system contracts
- `interfaces`: Interfaces for the system contracts
- `libraries`: `DELEGATECALL` libraries specific to this implementation
- `mocks`: Mock contracts for testing common to all prototypes

The less-central folders in the repository are dedicated to project management, configuration, and other ancillary details:

- Most of the top-level files are various forms of project-level configuration
- `common`: Shared utility types, methods, and constants in TypeScript
- `tasks`: [Hardhat tasks](https://hardhat.org/getting-started/)
- `scripts`: [Hardhat scripts](https://hardhat.org/guides/scripts.html)
- `types`: Typescript annotations; currently just `export interface Address {}`

## Differential Testing

This protocol is complex enough, in a demanding enough space, and has a high enough need for correctness, that it's worth thinking about it and implementing it using the method of _progressive specification_. In progressive specification, you implement (and maintain!) several versions of your overall system:

- _Prototype 0_ is as simple and intuitive as we can make it — as close as we can make it to "obviously correct by construction"
- For each _N_, you can neatly describe how _Prototype N+1_ is supposed to relate to _Prototype N_ — and because both systems are executable, you can actually run them and compare their results.
- The most complex system, _Prod_ is the system you intend to actually deploy.

We're building and testing _all_ of these systems. A whole set of generic test cases, written against a generic interface, run over the whole collection. Moreover, we can fuzz each subsequent pair of systems and test them for equivalence. This is [differential testing](https://en.wikipedia.org/wiki/Differential_testing) between our prototypes.

### Planned Prototypes

#### Prototype 0

The abstract economic protocol expressed just as clearly as we can manage it, while forgoing any attempt to be a realistic Ethereum protocol.

- Optimized for _obviousness_ and _clarity of expression_
- No constraints on execution speed or gas costs
- Normalize state as much as possible
- Things that happen after time delays are pulled, not pushed, and require two transactions.

#### Prototype 1

Like Prototype 0, but algorithmically modified as needed to deal with the block gas limit.

- Each external call takes _O(1)_ time and space where possible.
- No external call takes more than _O(lg N)_ time or space.
- No user is forced to pay gas for other users' processing, where possible.

Equivalence: P1 perfectly bisimulates P0.

#### Prototype 2

Like Prototype 1, but accounting for numerical precision

- Explicitly choose and document the overall rounding policy. Something like:
  - Error ratios are no more than 1 part in a million
  - Monetary errors are no more than $0.01 of token value
  - The directions of errors always favor the protocol
- Propagate the rounding policy into:
  - Comments on command interfaces (and wherever else it may be relevant)
  - Math libraries (if necessary)
  - Unit and property tests of the system
- Ensure that Prototype 2 actually meets that policy.

Equivalence: P2 bisumulates P0 and P1, except that:

- Observable numeric values coming out of P2 may be off those of P0, up to some small delta, and only in the direction that favors the protocol
- P2 may prohibit more transactions that employ only small values of tokens.

#### Production

Like Prototype 2, but with substantial gas optimizations. This may entail accepting severe design tradeoffs to the overall contract architecture as well as overall understandability.

Equivalence: Prod perfectly bisimulates P2.

## Types of Tests

We have two different general families of tests:

- _Generic Test_

  We say that a test is _generic_ if it uses our EVM generic test interface. When it does, a single test case can be run over all system implementations (prototypes).

Within the generic tests, we have two further types of tests: generic unit tests vs fuzz tests. The fuzz tests are (will be) written using Echidna. 

- _Particular Test_

  In contrast, we say that a test is _particular_ if it is not generic. That is, it uses interfaces other than the EVM generic test interface, so that it can check the details of a specific system implementation.

Finally, inside particular testing, it's quite useful to distinguish unit tests from full end-to-end tests. As such, we expect to write tests of the following 5 types:

- **Differential Tests**
  - Generic
  - Can be driven by Echidna
  - Checks that protocol implementations have equivalent behaviors
  - Check invariants
- **Generic Protocol Tests**
  - Generic
  - Driven by Hardhat
  - Checks that protocol implementations have expected behaviors
  - Mock out whatever helps to define
- **Component Property Tests** (todo)
  - Particular
  - Driven by Echidna
  - Checks properties of specific components
  - Requires extra EVM testing contracts
- **Component Unit Tests**
  - Particular
  - Driven by Hardhat
  - Checks properties of specific components
  - Mock out whatever helps us predict component behavior
- **End-to-End Tests**
  - Particular
  - Driven by Hardhat
  - Checks that the Production protocol works when deployed
  - Tests all needed contracts, contract deployment, any migrations, etc.
  - Mock out as little as possible
  - Almost certainly uses mainnet forking
