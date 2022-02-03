Relatively incomplete instructions for developers to setup, configuration, and use the tools in this repository.

# The Development Environment

We're using [hardhat](hardhat.org) as our main project management tool, with which we compile contracts, run unit tests, and perform deployments.

We're also using [Slither][] and [Echidna][], from the [Trail of Bits contract security toolkit][tob-suite] for linter-style static analysis, fuzz checking, and differential testing.

To run our full compilation and testing environment, you'll need to set up all of these.

[echidna]: https://github.com/crytic/echidna
[slither]: https://github.com/crytic/slither
[tob-suite]: https://blog.trailofbits.com/2018/03/23/use-our-suite-of-ethereum-security-tools/

These instructions assume you already have standard installations of `node`, `npm`, and `python3`.

## Setup Hardhat

This will do set up yarn and hardhat, needed for compiling and running basic tests

Install `yarn` (if required)

```bash
npm install -g yarn
```

Clone this repository:

```bash
git clone git@github.com:reserve-protocol/protocol.git
```

Install the required modules:

```bash
# Install required modules
cd ~/path/to/project
yarn
```

Create a local `.env` file:

```bash
# In project folder
cp .env.example .env
```

## Setup Trail of Bits Tools

### solc-select

The [Trail of Bits tools][tob-suite] require solc-select. Check [these installation instructions](https://github.com/crytic/solc-select) to ensure you have all pre-requisites. Then install solc-select, and set the version to `0.8.9`:

```bash
pip3 install solc-select
solc-select install 0.8.9
solc-select use 0.8.9
```

### Slither

NOTE: Right now, slither chokes on our code. We're hoping they update to working over solidity 0.8.9 sometime soon; until then, I guess we're just not using this. D:

Slither depends on `solc-select`. Once it's set up, install slither with:

```bash
pip3 install slither-analyzer
```

### Echidna

Echidna depends on both `solc-select` and `slither`. To handle recent Solidity language changes, we'll need Echidna 2.0, which is still in beta. Unless you have a Haskell toolchain all set up, you should install Echidna through precompiled binaries.

Until Echidna 2.0 is fully released, you can get precompiled binaries from that repo's [latest binary build](https://github.com/crytic/echidna/actions/runs/1119937162).

On MacOS, putting the contents of that build somewhere in your `PATH` will install it. However, that build is a binary plus a handful of dynamic libs that it's expecting to find as siblings in its directory. To keep things clean, I recommend the following:

```bash
# First, download and unpack echidna-test.zip somewhere. Then...
mv echidna-test ~/local/echidna-test

# Make an executable symlink wherever you keep your personal binaries (i.e, on your PATH)
ln -s ~/local/bin/echidna-test ~/local/echidna-test/echidna-test
chmod a+x ~/local/bin/echidna-test
```

# Run Tools

## Work on Code

Compile the smart contracts:

    yarn compile

Flatten our contract source code:

    yarn flatten

Run our standard formatting over the smart contracts and test files:

    yarn prettier

## Test Code

Run tests:

    yarn test

Run tests after a forced recompile:

    yarn test:recompile

Run tests in parallel:

    yarn test:parallel

Do test-coverage analysis:

    yarn coverage

Run the solhint linter:

    yarn lint:sol

Run Slither, for static analysis:

    yarn slither

Run Echidna, for fuzz and differential testing:

    yarn echidna

## Before Pushing Upstream

Before making a pull request to push your changes upstream (to `master` or whatever other branch people are working on), make sure that you

1. Get no errors when you run `yarn lint:sol; yarn slither; yarn test`
2. Standard-format all your code with `yarn prettier`

These are not yet git hooks, because not everything yet reliably works for the version of Solidity we're using.

## Deploy

First, Make sure the local enviroment (`.env`) is properly configured:

```json
# Mnemonic, first address will be used for deployments
MNEMONIC=""

# Ropsten Infura URL, used for Testnet deployments
ROPSTEN_RPC_URL=""

#  Alchemy Mainnet URL, used for Mainnet forking
ALCHEMY_MAINNET_RPC_URL=""
```

Next, you need to complete the network configuration (`networkConfig`) for the desired network. This can be located at `\common\configuration.ts`. These settings will be used to validate supported networks and reuse components which may be already deployed.

For now these are the supported networks:

```
const networkConfig = {
    default: {
        name: 'hardhat',
    },
    31337: {
        name: 'localhost',
    },
    3: {
        name: 'ropsten',
      },
    1: {
        name: 'mainnet',
    }
```

Now, fdor deploying the full suite, you can use the available scripts located at `\scripts`.

- `scripts\deploy-all.ts`: Deploys all components and mockups (mainly oriented for local development, but works for Testnets as well). Uses default configuration for a generic `RToken`.

### Local deployment (Hardhat network)

Run the following commands:

```bash
# In one terminal (run Hardhat network)
$ yarn devchain

# Open another tab/terminal
$ yarn deploy:localhost
```

Once contracts are deployed you can interact with them by running:

```bash
$ npx hardhat --network localhost console
```

### Ropsten deployment (Testnet)

- [Get Test Ether](https://faucet.ropsten.be/)
- Make sure contract addresses are properly configured for Ropsten network (`chainId = 3`) in the `networkConfig` object, and run the following commands:

```bash
# In one terminal
$ yarn deploy:ropsten
```

Once contracts are deployed you can interact with them by running:

```bash
$ npx hardhat --network ropsten console
```

# Code/Documentation Style

## Assets/Collateral

An ERC20 exists in our system wrapped in either an *Asset* or *Collateral* contract. The definition of an asset is very broad. Any ERC20 that can have a price in the unit of account (most likely USD) can be an asset. A collateral is a specific type of asset that enables an ERC20 to act as backing for an RToken. 

## Units

The units of variables is tracked in comments in the implementation. Curly braces are used to denote units, e.g. `{UoA/qTok}`.

The `q` prefix denotes "quanta", ie the smallest indivisible unit of the token.

The `atto` prefix denotes 1e18.

Otherwise, the unit is assumed to be whole. The meaning of a "whole" token changes depending on how many decimals that token has. 

- {qTok} = token quanta
- {tok} = whole token = 1e6{qTok} (USDC) = 1e18{qTok} (DAI)
- {ref} = whole reference token (USDC is cUSDC's reference token)
- {target} = whole target unit (USD is cUSDC's target unit)
- {BU} = whole basket unit
- {UoA} = whole unit of the Unit of Account (which is probably USD)


## Token Balances (at least true for P0, pending confirmation it remains the same in P3)

- `Main`: Holds all backing for the RToken
- `RToken`: Holds collateral tokens during SlowIssuance
- `Furnace`: holds revenue RToken to be melted
- `stRSR`: holds staked RSR
- `RevenueTrader`: Holds and trades some asset A for either RSR or RToken for melting

## RToken Lifecycle

1. During SlowIssuance, `Main` transfers collateral tokens from the issuer's address to the `RToken`. 
2. At the end of SlowIssuance, the `RToken` contract mints new RToken to the issuer and transfers the held collateral to `Main`. If `Main` has updated the basket since issuance began, then the collateral is instead returned to the user and no RToken is minted. 
3. During redemption, RToken is burnt from the redeemer's account and they are transferred collateral from `Main`.
