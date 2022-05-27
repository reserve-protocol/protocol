Relatively incomplete instructions for developers to setup, configuration, and use the tools in this repository.

# The Development Environment

We're using [hardhat](hardhat.org) as our main project management tool, with which we compile contracts, run unit tests, and perform deployments.

We're also considering using [Slither][] and [Echidna][], from the [Trail of Bits contract security toolkit][tob-suite] for linter-style static analysis, fuzz checking, and differential testing. (But ignore these for now)

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

Slither depends on `solc-select`. Once that's set up, we need to get slither _from its latest github repository_, as we're using language features that aren't supported in its most recent pacakaging release. The easiest way I've found to ensure this works right is to first uninstall any previous versions. You can do all of this as follows:

```bash
pip uninstall slither-analyzer --yes
pip3 install -U https://github.com/crytic/slither/archive/refs/heads/master.zip
```

### Echidna

Echidna depends on both `solc-select` and `slither`. To handle recent Solidity language changes, we'll need Echidna 2.0. Unless you have a Haskell toolchain all set up, you should install Echidna through precompiled binaries.

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

## Mainnet Forking

The tests located in `test/integration` will require the Mainnet Forking setup in place. This is done by setting the `MAINNET_RPC_URL` variable in your local `.env`. An Alchemy node is recommended for Mainnet Forking to properly work. Additional information can be found [here](https://hardhat.org/hardhat-network/guides/mainnet-forking.html).

For running scripts and tasks using Mainnet Forking a `FORK` environment variable can be defined. For example to run a local node using Mainnet forking you can run:

```bash
FORK=true npx hardhat node
```

## Upgrades

Components of the production version `P1` are designed to be **upgradeable** using the **Proxy Upgrade Pattern** implemented by OpenZeppelin. More information about this general pattern can be found [here](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies)

This implies that the core contracts in `P1` (`Main` and core components) are meant to be deployed as **implementation** contracts, which will serve as a reference to deploy later specific instances (or **"proxies"**) via the `Deployer` contract. If changes are required in the future, a new implementation version can be deployed and the Proxy can be upgrated to point to
this new implementation, while preserving its state and storage.

When **upgrading** smart contracts it is crucial to keep in mind the **limitations** of what can be changed/modified to avoid breaking the contracts. Additional information can be found [here](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable) It is highly recommended to use the _OpenZeppelin Upgrades plugin_ (already included in this repo) to ensure implementations are "upgrade safe" before upgrading any smart contract.

The recommended process to perform an upgrade is the following:

- Create the new implementation version of the contract. This should follow all the recommendations from the article linked above, to make sure the implementation is "Upgrade Safe"
- Ensure metadata of the existing/deployed proxies is created for the required network. This is located in a folder names `.openzeppelin`, which should be persisted in `git` for Production networks. Because the initial proxies are deployed via the `Deployer` factory contract, this folder needs to be created using the [forceImport](https://docs.openzeppelin/upgrades-plugins/1.x/api-hardhat-upgrades#force-import) function provided by the plugin. A concrete example on how to use this function is provided in our Upgradeability test file (`test/Upgradeability.test.ts`)
- Using MAINNET FORKING, make sure you perform tests to check the new implementation behaves as expected. Proxies should be updated using the [upgradeProxy]() function provided by the plugin to ensure all validations and checks are performed.
- Create a deployemnt script to the required network (Mainnet) (using `upgradeProxy`). Ensure the new version of the `.openzeppelin` files are checked in to `git` for future reference.

For additional information on how to use the plugins and how to perform upgrades on smart contracts please refer to the OpenZeppelin docs site: https://docs.openzeppelin.com/upgrades

# Things in the Documentation Style

## Assets/Collateral

An ERC20 exists in our system wrapped in either an _Asset_ or _Collateral_ contract. The definition of an asset is very broad. Any ERC20 that can have a price in the unit of account (most likely USD) can be an asset. A collateral is a specific type of asset that enables an ERC20 to act as backing for an RToken.

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

# Some Input Ranges and Granularities

Minimum ranges for covering entire spans:

- Token balances: [0, 1e18] by 1e-18 steps: 128 bits
- RSR balances: [0, 1e29] qTokens: 104 bits
- Times in seconds: uint40 (maybe uint32 if it really helps?)

# System Tokens

## Token Balances

- `BackingManager`: Holds all backing for the RToken
- `RToken`: Holds collateral tokens during SlowIssuance
- `Furnace`: holds revenue RToken to be melted
- `stRSR`: holds staked RSR
- `RevenueTrader`: Holds and trades some asset A for either RSR or RToken for melting

## RToken Lifecycle

1. During SlowIssuance, the `RToken` transfers collateral tokens from the issuer's address into itself.
2. At vesting time, the `RToken` contract mints new RToken to the issuer and transfers the held collateral to the `BackingManager`. If the `BasketHandler` has updated the basket since issuance began, then the collateral is instead returned to the user and no RToken is minted.
3. During redemption, RToken is burnt from the redeemer's account and they are transferred a prorata share of backing collateral from the `BackingManager`.

# Deployment Parameters

## `maxTradeVolume`

{UoA}

The max trade volume is a value in the unit of account that represents the largest amount of value that should be transacted in any single trade. This value is distributed on deployment to the initial RSR, RToken, AAVE, and COMP assts. After deployment the values are allowed to differ.

Anticipated value: `1e6` = $1m

## `rewardPeriod`

{seconds}

The reward period is the length of one period of the StRSR and Furnace reward curves, which use exponential decay in order to hand out rewards slowly. The `rewardPeriod` must be set in conjuction with `rewardRatio` in order to achieve a desired payout rate. The `rewardPeriod` is the length of time that comprises a single period. Over a single period, `rewardRatio` of the last balance recorded is handed out. For multiple periods, the amount handed out is `(1 - (1-r)^N)`, where `r` is the `rewardRatio` and `N` is the number of periods elapsed.

Anticipated value: `86400` = 1 day

## `rewardRatio`

{%}

The `rewardRatio` is the amount of the current reward amount that should be handed out in a single period. See above.

Anticipated value: `0.02284e18` = causes the half life to occur at 30 periods

## `unstakingDelay`

{seconds}

The unstaking delay is the number of seconds that all RSR unstakings must be delayed in order to account for stakers trying to frontrun defaults. It may also be influenced by the length of governance votes.

Anticipated value: `1209600` = 2 weeks

## `tradingDelay`

{seconds}

The trading delay is how many seconds should pass after the basket has been changed, before a trade is opened. In the long-term this can probably trend towards zero but at the start we will want some heads up before trading in order to avoid losses due to poor liquidity.

Anticipated value: `14400` = 4 hours

## `auctionLength`

{seconds}

The auction length is how many seconds long Gnosis EasyAuctions should be.

Anticipated value: `900` = 15 minutes

## `backingBuffer`

{%}

The backing buffer is a percentage value that describes how much additional collateral tokens to keep in the BackingManager before forwarding tokens to the RevenueTraders. This helps cause collateral tokens to more reliably be converted into RToken, which is the most efficient form of revenue production.

Anticipated value: `0.0001e18` = 0.01%

## `maxTradeSlippage`

{%}

The max trade slippage is a percentage value that describes the maximum deviation from oracle prices that any trade can clear at.

Anticipated value: `0.01e18` = 1%

## `dustAmount`

{UoA}

The dust amount is a value in the unit of account that represents the smallest amount of value that it is worth executing a trade for. This parameter is a function of the strength of time preferences during recapitalization. It should be set such that the protocol is happy to accept donated assets and run a recapitalization auction with them, rather than proceed to RSR seizure.

Anticipated value: `1000e18` = $1,000

## `issuanceRate`

{%}

The issuance rate is a percentage value that describes what proportion of the RToken supply to issue per block. It controls how quickly the protocol can scale up RToken supply.

Anticipated value: `0.00025e18` = 0.025% per block
