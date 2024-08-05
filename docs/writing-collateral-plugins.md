# Writing Collateral Plugins

This document describes the general process a developer should follow when writing a new collateral plugin.

For details of what collateral plugins are and how they function, see [collateral.md](./collateral.md). Be sure to read and understand [collateral.md](./collateral.md) before beginning the process of writing a new collateral plugin.

## Pre-implementation Questions

Here are some basic questions to answer before beginning to write a new collateral plugin. Think of the answers like an outline for an essay: they will help gauge how much work is required to write the plugin, they will guide the final implementation, and they will contain all of the human-readable details that can then be directly translated into code.

1. **Is this collateral sufficiently valuable? At-peg it must be worth at least $0.001 if it has 18 decimals, and $1 if it has 21 decimals.**
1. **How will this plugin define the different units?**
   - {tok}:
   - {ref}:
   - {target}:
   - {UoA}:
1. **Does the target collateral require a wrapper?** (eg. aTokens require the StaticAToken wrapper, to stabilize their rebasing nature)
1. **How will the 3 internal prices be defined?** (eg. chainlink feeds, exchange rate view functions, calculations involving multiple sources) For [chainlink feeds](https://data.chain.link/ethereum/mainnet), include the address, error (deviation threshold), and timeout (heartbeat). For on-chain exchange rates, include the function calls and/or github links to examples.
   - {ref/tok}:
   - {target/ref}:
   - {UoA/target}:
1. **For each of these prices, what are the critical trust assumptions? Can any of these be manipulated within the course of a transaction?**
   - eg. chainlink feeds require trusting the chainlink protocol and the individual oracles for that price feed
   - eg. yearn vaults can have their `pricePerShare` increased via direct vault donations
   - eg. is pricing manipuable or subject to MEV? oracle sources _must_ be manipulation resistant such as Chainlink or AMM EMA
1. **Are there any protocol-specific metrics that should be monitored to signal a default in the underlying collateral?**
1. **If this plugin requires unique unit & price abstractions, what do they look like?**
1. **What amount of revenue should this plugin hide? (a minimum of `1e-6`% is recommended, but some collateral may require higher thresholds, and, in rare cases, `0` can be used)**
1. **Are there rewards that can be claimed by holding this collateral? If so, how are they claimed?** Include a github link to the callable function or an example of how to claim.
1. **Does the collateral need to be "refreshed" in order to update its internal state before refreshing the plugin?** Include a github link to the callable function.
1. **Can the `price()` range be kept <5%? What is the largest possible % difference (while priced) between `price().high` and `price().low`?** See [RTokenAsset.tryPrice()](../contracts/plugins/assets/RTokenAsset.sol) and [docs/collateral.md](./collateral.md#price) for additional context.

## Implementation

The collateral plugin should be aptly named and placed in a folder (along with any additional contracts needed) named for the collateral's protocol under `contracts/plugins/assets/<protocol>`. It should contain a README.md that gives an overview of the protocol being plugged into and contains the answers to the above questions.

Details for setting up a local dev environment for this repo can be found in [dev-env.md](./dev-env.md).

## Testing

The test suite for a collateral plugin should be aptly named and placed in a folder named for the collateral's protocol under `test/individual-collateral/<protocol>`. The test suite will not look or act like a normal .test.ts file, but rather it will import a generic test file and pass it an object containing the necessary fixture class that extends `CollateralTestSuiteFixtures<X>`. You can find explanations of the various pieces that make up a `CollateralTestSuiteFixtures` in `test/plugins/individual-collateral/pluginTestTypes.ts`, and feel free to look at any existing collateral test suites for examples of how best to build this fixture.

Collateral plugin tests must be run on a mainnet fork to ensure they properly integrate with the target protocol. Set the desired fork block in the `constants.ts` file you create for use in the plugin test suite. If used elsewhere, you can also set a fork block in `test/integration/fork-block-numbers.ts`.

In your `.env` file, set:

```
FORK=1
```

To run a specific test suite:

```
npx hardhat test test/plugins/individual-collateral/<protocol>/<MyNewCollaterPlugin>.test.ts
```

## Submission

Make a pr against the `master` branch in the Reserve [protocol repo](https://github.com/reserve-protocol/protocol).

## Support

If you need support along the way, join us in the [Reserve discord](https://discord.gg/FYsAUB3m) #technical-discussions channel.
