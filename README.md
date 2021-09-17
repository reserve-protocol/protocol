# reserve-protocol

## Introduction

TODO

## Development Environment

### Yarn Installation

Install `yarn` (if required)

```bash
$ npm install -g yarn
```

Clone this repository:

```bash
$ git clone git@github.com:reserve-protocol/protocol.git
```

Install the required modules:

```bash
# Install required modules
$ cd ~/path/to/project
$ yarn
```

Create a local `.env` file:

```bash
# In project folder
$ cp .env.example .env
```

## Running Tests

To run tests run the following command:

```bash
$ yarn test
```

## Linting Solidity

Linting the Solidity code:

```bash
$ yarn lint:sol
```

## Static Analysis with Slither

- Make sure `slither` is installed and properly working. Follow the instructions [here](https://github.com/crytic/slither#how-to-install) and check all pre-requisites are met.

```bash
$ pip3 install slither-analyzer
```

- You will also need `solc-select` installed (instructions [here](https://github.com/crytic/solc-select)) and set to version `0.8.4`.

```bash
$ pip3 install solc-select
$ solc-select install 0.8.4
$ solc-select use 0.8.4
```

- Run `slither` using this command:

```bash
$ yarn slither
```

## Security Analysis with Mythril

- Make sure `mythril` is installed and properly working. We recommend using **Docker** for this as many issues exit when installing via `pip3`. Follow the instructions [here](https://mythril-classic.readthedocs.io/en/master/installation.html). You can get Docker [here](https://docs.docker.com/get-docker/)

```bash
$ docker pull mythril/myth
```

```bash
# Check it properly installed
$ docker run mythril/myth --help
```

- Run `mythril` using this command:

```bash
$ yarn mythril
```

**Note:** In case you are running `myth analyze` directly you can modify the command being executed in `./mythril.sh`. You can also add/remove contracts to analyze by changing the script in this file

## Fuzzing with Echidna 2.0

- Make sure `echidna 2.0` is installed. We recommend using **precompiled binaries**. You can get the temporary pre-release [here](https://github.com/crytic/echidna/actions/runs/1119937162). You will need prerequisites as `slither` and `solc-select` also installed. Check this [previous](##Static-Analysis-with-Slither) section to install and configure these components.

- Run `echidna` script:

```bash
$ yarn echidna
```

- Run `echidna` on specific contract:
  
```bash
$ echidna-test *.sol --contract CONTRACT_NAME --config echidna.config.yml
```

**Note:** You can modify the commands and files being processed in `./echidna.sh`. Configurations are defined in `echidna.config.yml`.

## Deployments

1- Make sure the local enviroment (`.env`) is properly configured:

```json
# Mnemonic, first address will be used for deployments
MNEMONIC=""

# Ropsten Infura URL, used for Testnet deployments
ROPSTEN_RPC_URL=""

#  Alchemy Mainnet URL, used for Mainnet forking
ALCHEMY_MAINNET_RPC_URL=""
```

2 - You also need to complete the network configuration (`networkConfig`) for the desired network. This can be located at `\common\configuration.ts`. These settings will be used to validate supported networks and reuse components which may be already deployed.

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

3 - For deploying the full suite you can use the available scripts located at `\scripts`.

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

- Get Test Ether (https://faucet.ropsten.be/)
- Make sure contract addresses are properly configured for Ropsten network (`chainId = 3`) in the `networkConfig` object, and run the following commands:

```bash
# In one terminal
$ yarn deploy:ropsten
```

Once contracts are deployed you can interact with them by running:

```bash
$ npx hardhat --network ropsten console
```

- You can obtain Test Ether here: https://faucet.ropsten.be/ (other faucets also available)
