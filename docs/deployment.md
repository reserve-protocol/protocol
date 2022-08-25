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

# Goerli Infura URL, used for Testnet deployments
GOERLI_RPC_URL=""


# Mainnet URL, used for Mainnet forking
MAINNET_RPC_URL=""

# Etherscan API key, used for verification
ETHERSCAN_API_KEY=""
```

Next, you need to complete the network configuration (`networkConfig`) for the desired network. This can be located at `/common/configuration.ts`. These settings will be used to validate supported networks and reuse components which may be already deployed.

Supported networks for `networkConfig`:

```json

const networkConfig = {
    default: { name: 'hardhat', },
    31337: { name: 'localhost', },
    3: { name: 'ropsten', },
    1: { name: 'mainnet', },
    5: { name: 'mainnet', },

    [...]
 }
```

## Deployment

The deployment process consists of three main phases (that can be executed via a single command). The scripts required for each phase are located in the `scripts/deployment` folder. Run:

```
npx hardhat run scripts/deploy_all --network {NETWORK}
```

### Phases

- **Phase 1 - Common:** Required to deploy the core components of the Reserve Protocol. This includes required Solidity libraries, the implementation contracts of each system component, and some auxiliary components as the `Facade`, `Deployer`, and `FacadeWrite` contracts. This deployment phase has to be executed only **once** for all RTokens. Scripts are located in `/scripts/deployment/phase1-common`.

- **Phase 2 - Assets/Collateral:** Required to deploy new asset and collateral contracts that will be used for the deployment of a new RToken. The exact setup to deploy will depend on each case and can be customized for each particular RToken. Once an asset/collateral is deployed it can be reused for several RTokens. Scripts are located in `scripts/deployment/phase2-assets-collateral`.

- **Phase 3 - RToken:** Required to deploy a new RToken. Uses a configuration file and can be customized with the required parameters. Deployments are done via public functions in the `FacadeWrite` contract. Scripts are located in `scripts/deployment/phase3-rtoken`.

There is a single meta-script that wraps all scripts at `scripts/deployment/deploy_all.ts`. When run, this script will produce 3 output files of the form `31337-*.json`.

1. `31337-tmp-deployments.json`: Contains prerequisite + implementation addresses
2. `31337-tmp-assets-collateral.json`: Contains asset plugin addresses
3. `31337-{RTOKEN SYMBOL}-tmp-deployments.json`: Contains the (proxied) addresses that make up the real runtime system

### Mainnet forking

- Before running the `deploy_all` script (or any particular script), run in a separate terminal a local forking node:

```bash
FORK=true npx hardhat node
```

### Deploying to other networks

The same scripts can be executed against a Testnet or Mainnet network. Make sure the correct network is specified when executing the scripts (eg:`--network mainnet`)

A specific set of files will be created for that specific network (using the network `chainId` as prefix)
