# The Reserve Protocol

The Reserve protocol allows anyone to create stablecoins backed by baskets of ERC-20 tokens on Ethereum.

## Overview

RTokens can be minted by depositing the entire basket of collateral backing tokens, and redeemed for the entire basket as well. Thus, an RToken will tend to trade at the market value of the entire basket that backs it, as any lower or higher price could be arbitraged.

RTokens can be insured, which means that if any of their collateral tokens default, there's a pool of value available to make up for the loss. RToken insurance is provided by Reserve Rights (RSR) holders, who may choose to stake their RSR on any RToken. Staked RSR can be seized in the case of a default, in a process that is entirely mechanistic based on on-chain price-feeds, and does not depend on governance votes or human judgment.

RTokens can generate revenue, and this revenue is the incentive for RSR holders to stake. Revenue can come from transaction fees, revenue shares with collateral token issuers, or yield from lending collateral tokens on-chain.

As with any smart contract application, the actual behavior may vary from the intended behavior, and it's safest to wait for an application to be in use for a long period of time before trusting it to behave as expected. This overview describes its _intended_ behavior.

For a much more detailed explanation of the economic design, see [the Reserve website](https://reserve.org/protocol/2021_version/).

## Development
Developers: See setup and repository usage notes at [docs/developers.md](docs/developers.md).

## Repository Structure

The central directories in this repository are `contracts` and `test`.

`test` holds our Typescript tests driven through hardhat.

`contracts` holds all our smart contracts, organized as follows:

- `libraries`: Common `DELEGATECALL` libraries
- `prod`: The real Reserve Protocol implementation
- `proto0`, `proto1`, `proto2`: [Progressive prototypes][#differential_testing]
- `mocks`: Mock contracts for testing

Each implementation directory (`prod`, `proto0`, `proto1`, `proto2`) contains the following:

- Top-level files: The system contracts
- `interfaces`: Interfaces for the system contracts
- `libraries`: `DELEGATECALL` libraries specific to this implementation
- `mocks`: Mock contracts for testing

The less-central folders in the repository are dedicated to project management, configuration, and other ancillary details:

- The top-level files are all various forms of project-level configuration
- `common`: Shared utility types, methods, and constants in TypeScript
- `tasks`: [Hardhat tasks](https://hardhat.org/getting-started/)
- `scripts`: [Hardhat scripts](https://hardhat.org/guides/scripts.html)
- `types`: Typescript annotations; currently just `export interface Address {}`
## Differential Testing

This protocol is complex enough, in a demanding enough space, and has a high enough need for correctness, that it's worth thinking about it and implementing it using the method of *progressive specification*. In progressive specification, you implement (and maintain!) several versions of your overall system:

- *Prototype 0* is as simple and intuitive as we can make it — as close as we can make it to "obviously correct by construction"
- For each *N*, you can neatly describe how *Prototype N+1* is supposed to relate to *Prototype N* — and because both systems are executable, you can actually run them and compare their results.
- The most complex system, *Prod* is the system you intend to actually deploy.

We're building and testing *all* of these systems. A whole set of generic test cases, written against a generic interface, run over the whole collection. Moreover, we can fuzz each subsequent pair of systems, testing them for observational equivalence. This is [differential testing](https://en.wikipedia.org/wiki/Differential_testing) between our prototypes.

### Planned Prototypes

#### Prototype 0

The abstract economic protocol expressed just as clearly as we can manage it, while forgoing any attempt to be a realistic Ethereum protocol.

- Optimized for _obviousness_ and _clarity of expression_
- No constraints on execution speed or gas costs
- Normalize state as much as possible
- Things that happen after time delays are pulled, not pushed, and require two transactions.
- Updates may *not* be assumed to happen every block, though the "every block" pattern that we've so-far used (in which some function is the first state-effecting thing that can happen every block) is just fine

#### Prototype 1

Like Prototype 0, but algorithmically modified as needed to deal with the gas block limit.

- Each external call takes _O(1)_ time and space where possible.
- No external call takes more than _O(lg N)_ time or space.
- No user is forced to pay gas for other users' processing, if at all possible.

Equivalence: P1 perfectly bisimulates P0.

#### Prototype 2

Like Prototype 1, but account for numerical precision

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

Like Prototype 2, but with substantial gas optimizations. This may entail accepting severe design tradeoffs to the overall contract architecture.

Equivalence: Prod perfectly bisimulates P2.

## Types of Tests

We have two different general families of tests:

- *Generic Test*

    We say that a test is *generic* if it uses our EVM generic test interface. When it does, a single test case can be run over all system implementations.

- *Particular Test*

    In contrast, we say that a test is *particular* if it is not generic. That is, it uses interfaces other than the EVM generic test interface, so that it can check the details of a specific system implementation.

Further, tests will be hosted by two different systems, Echidna and Hardhat, each of which have different strengths and weaknesses. Together, these yield 4 overall test types.

Finally, inside particular, testing in Hardhat, it's quite useful to distinguish unit tests from full end-to-end tests. As such, we expect to write tests of the following 5 types:

- **Differential Tests**
    - Generic
    - Driven by Echidna
    - Checks that protocol implementations have equivalent behaviors
    - Check invariants
- **Generic Protocol Tests**
    - Generic
    - Driven by Hardhat
    - Checks that protocol implementations have expected behaviors
    - Mock out whatever helps to define
    - May use fast-check (but doesn't have to)
- **Component Property Tests**
    - Particular
    - Driven by Echidna
    - Checks properties of specific components
    - Requires extra EVM testing contracts
- **Component Unit Tests**
    - Particular
    - Driven by Hardhat
    - Checks properties of specific components
    - Mock out whatever helps us predict component behavior
    - May use fast-check (but doesn't have to)
- **End-to-End Tests**
    - Particular
    - Driven by Hardhat
    - Checks that the Production protocol works when deployed
    - Tests all needed contracts, contract deployment, any migrations, etc.
    - Mock out as little as possible
    - Almost certainly uses mainnet forking
    - May use fast-check (but doesn't have to)
