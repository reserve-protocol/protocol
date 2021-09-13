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

-   `scripts\deploy-all.ts`: Deploys all components and mockups (mainly oriented for local development, but works for Testnets as well). Uses default configuration for a generic `RToken`.

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

-   Get Test Ether (https://faucet.ropsten.be/)
-   Make sure contract addresses are properly configured for Ropsten network (`chainId = 3`) in the `networkConfig` object, and run the following commands:

```bash
# In one terminal
$ yarn deploy:ropsten
```

Once contracts are deployed you can interact with them by running:

```bash
$ npx hardhat --network ropsten console
```

-   You can obtain Test Ether here: https://faucet.ropsten.be/ (other faucets also available)
