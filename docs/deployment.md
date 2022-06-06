# Deploying our Smart Contracts

Mostly, this is about _test_ deployment, though the same elements should work to deploy to any network once configured.

Real mainnet deployment, though, will entail an deployment checklist (not yet written) and serious operational security considerations (not yet articulated).

## Configure Environment
First, make sure your local environment configuration, in `.env`, is actually filled out. (`.env` is git-ignored; don't force-commit it somehow!)

```json
# Mnemonic, first address will be used for deployments
MNEMONIC=""

# Ropsten Infura URL, used for Testnet deployments
ROPSTEN_RPC_URL=""

#  Mainnet URL, used for Mainnet forking
MAINNET_RPC_URL=""
```

Next, you need to complete the network configuration (`networkConfig`) for the desired network. This can be located at `/common/configuration.ts`. These settings will be used to validate supported networks and reuse components which may be already deployed.

Supported networks for `networkConfig`:

```json

const networkConfig = {
    default: { name: 'hardhat', },
    31337: { name: 'localhost', },
    3: { name: 'ropsten', },
    1: { name: 'mainnet', },
    
    [...]
 }
```
## Usage

To deploy the full suite, you can use `scripts\deploy-all.ts`. It should deploys all components and mockups. It's mainly oriented for local development, but works for Testnets as well. It will use a default configuration for a generic `RToken`.

### Deploy to Local Hardhat network

If it's not already running, run the Hardhat network in one terminal:

    yarn devchain

In a separate terminal session, interact with your local network:

    yarn deploy:localhost

Once contracts are deployed you can interact with them in the hardhat console by running:

    yarn exec hardhat --network localhost console

### Deploy to Ropsten testnet

First, get test Ether, either by transfer from someone else or from the [Ropsten faucet](https://faucet.ropsten.be/) 

Make sure contract addresses are properly configured for Ropsten network (`chainId = 3`) in the `networkConfig` object.

Then, you can deploy (I think?) with

    yarn exec hardhat run scripts/deploy_all.ts --network ropsten

And, as with localhost interaction, once contracts are deployed you can interact with them in the hardhat console by running:

    yarn exec hardhat --network ropsten console

