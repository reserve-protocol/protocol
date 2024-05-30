# Our Development Environment

We're using:

- [Hardhat](hardhat.org) to compile, test, and deploy our smart contracts.
- [Slither][], [Slitherin][], and [Echidna][], from the [Trail of Bits contract security toolkit][tob-suite] for static analysis, fuzz checking, and differential testing.
- [Prettier][] to auto-format both Solidity and Typescript (test) code
- [Solhint][] for Solidity linting
- [ESlint][] for Typescript linting

[echidna]: https://github.com/crytic/echidna
[slither]: https://github.com/crytic/slither
[slitherin]: https://github.com/pessimistic-io/slitherin
[tob-suite]: https://blog.trailofbits.com/2018/03/23/use-our-suite-of-ethereum-security-tools/
[prettier]: https://prettier.io/
[solhint]: https://protofire.github.io/solhint/
[eslint]: https://eslint.org/

These instructions assume you already have standard installations of `node`, `npm`, and `python3`.

## Setup

### Basic Dependencies

Set up yarn and hardhat, needed for compiling and running tests:

```bash
# If needed, install yarn
npm install -g yarn

# Clone this repo
git clone git@github.com:reserve-protocol/protocol.git

# Install packages from npm (including Solidity dependencies)
cd protocol
yarn

# Setup git hooks
yarn prepare

# Init a local .env file
cp .env.example .env
```

### Tenderly

If you are going to use a Tenderly network, do the following:

1. Install the [tenderly cli](https://github.com/Tenderly/tenderly-cli)
2. Login

```bash
tenderly login --authentication-method access-key --access-key {your_access_key} --force
```

3. Configure the `TENDERLY_RPC_URL` in your `.env` file

### Slither

You should also setup `slither` and `slitherin`. The [Trail of Bits tools][tob-suite] require solc-select. Check [the installation instructions](https://github.com/crytic/solc-select) to ensure you have all prerequisites. Then:

```bash
# Install solc-select and slither
pip3 install solc-select slither-analyzer

# Include slitherin detectors within slither
pip3 install slitherin

# Install and use solc version 0.8.19
solc-select install 0.8.19
solc-select use 0.8.19

# Double-check that your slither version is at least 0.8.3!
hash -r && slither --version

# Slitherin version should be at least 0.7.0
slitherin --version
```

## Usage

- Compile: `yarn compile`
- Autoformat solidity and typescript: `yarn prettier`
- Report compiled contract sizes: `yarn size`
- There are many available test sets. A few of the most useful are:
  - Run only fast tests: `yarn test:fast`
  - Run P0 tests: `yarn test:p0`
  - Run P1 tests: `yarn test:p1`
  - Run plugin tests: `yarn test:plugins`
  - Run integration tests: `yarn test:integration`
  - Run tests and report test coverage: `yarn test:coverage`
- Lint Solidity + Typescript code: `yarn lint`
- Run the Slither static checker: `yarn slither` (will include Slitherin detectors)
- Run a local mainnet fork devchain: `yarn devchain`
- Deploy to devchain: `yarn deploy:run --network localhost`

## Mainnet Forking

The tests located in `test/integration` will require the Mainnet Forking setup in place. This is done by setting the `MAINNET_RPC_URL` variable in your local `.env`. An Alchemy or Ankr node (something with archive data) is needed for Mainnet Forking to properly work. Additional information can be found [here](https://hardhat.org/hardhat-network/guides/mainnet-forking.html).

## Pre-push Validation

We use git pre-push validation to ensure that the code in our `master` branch always lints, compiles, and at least passes our "fast" tests, before we even share it with each other. However, if you're working on a separate branch, and it's more practical to share code with teammates working to a different standard, you can easily comment out or otherwise modify the lines in `.husky/pre-push`, and commit those along with your branch.

However, ensure that you do not change the value of `.husky/pre-push` in our shared master branch; this _is_ the appropriate set of validations for sharing code there.

# Further Topics

## Echidna

We _have_ some tooling for testing with Echidna, but it is specifically in `fuzz` branch of the repo. See that branch and our [echidna usage docs](using-echidna.md)

## Test Deployment

See our [deployment documentation](deployment.md).

## Slither/Slitherin Analysis

The ToB Sliter tool is run on any pull request, and is expected to be checked by devs for any unexpected high or medium issues raised. It also includes the additional Slitherin detectors developed by Pessimistic.
