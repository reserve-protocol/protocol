

# Our Development Environment

We're using:

- [Hardhat](hardhat.org) to compile, test, and deploy our smart contracts.
- [Slither][] and [Echidna][], from the [Trail of Bits contract security toolkit][tob-suite] for static analysis, fuzz checking, and differential testing.
- [Prettier][] to auto-format both Solidity and Typescript (test) code
- [Solhint][] for Solidity linting
- [ESlint][] for Typescript linting

[echidna]: https://github.com/crytic/echidna
[slither]: https://github.com/crytic/slither
[tob-suite]: https://blog.trailofbits.com/2018/03/23/use-our-suite-of-ethereum-security-tools/
[prettier]: https://prettier.io/
[solhint]: https://protofire.github.io/solhint/
[eslint]: https://eslint.org/

These instructions assume you already have standard installations of `node`, `npm`, and `python3`.

## Setup

Set up yarn and hardhat, needed for compiling and running tests:

``` bash
# If needed, install yarn
npm install -g yarn

# Clone this repo
git clone git@github.com:reserve-protocol/protocol.git

# Install pacakges from npm (including Solidity dependencies)
cd protocol
yarn

# Setup git hooks
yarn prepare

# Init a local .env file
cp .env.example .env
```

You should also setup `slither`. The [Trail of Bits tools][tob-suite] require solc-select. Check [the installation instructions](https://github.com/crytic/solc-select) to ensure you have all prerequisites. Then:

```bash
# Install solc-select and slither
npip3 install solc-select slither-analyzer

# Install and use solc version 0.8.9
solc-select install 0.8.9
solc-select use 0.8.9

# Double-check that your slither version is at least 0.8.3!
hash -r && slither --version
```

## Usage

- Compile: `yarn compile`
- Autoformat solidity and typescript: `yarn prettier`
- Report compiled contract sizes: `yarn size`
- There are many available test sets. A few of the most useful are:
    - Run only fast tests: `yarn test:fast`
    - Run most tests: `yarn test`
    - Run all tests (very slow!): `yarn test:exhaustive`
    - Run tests and report test coverage: `yarn test:coverage`
- Lint Solidity code: `yarn lint`
- Lint Typescript code: `yarn eslint`
- Run the Slither static checker: `yarn slither`
- Run a local evm devchain: `yarn devchain`
- Deploy our system to your local evm devchain: `yarn deploy`

## Mainnet Forking

The tests located in `test/integration` will require the Mainnet Forking setup in place. This is done by setting the `MAINNET_RPC_URL` variable in your local `.env`. An Alchemy node is recommended for Mainnet Forking to properly work. Additional information can be found [here](https://hardhat.org/hardhat-network/guides/mainnet-forking.html).

For running scripts and tasks using Mainnet Forking a `FORK` environment variable can be defined. For example to run a local node using Mainnet forking you can run:

```bash
FORK=true npx hardhat node
```

## Pre-push Validation

We use git pre-push validation to ensure that the code in our `master` branch always lints, compiles, and at least passes our "fast" tests, before we even share it with each other. However, if you're working on a separate branch, and it's more practical to share code with teammates working to a different standard, you can easily comment out or otherwise modify the lines in `.husky/pre-push`, and commit those along with your branch.

However, ensure that you do not change the value of `.husky/pre-push` in our shared master branch; this _is_ the appropriate set of validations for sharing code there.

# Further Topics

## Echidna

We _have_ some tooling for testing with Echidna, but it is immature, out-of-date, and shouldn't be expected to work out-of-the-box. Still, there is some useful, tested support for working with Echidna, see our [echidna usage docs](using-echidna.md)

## Test Deployment

See our [deployment documentation](deployment.md).

