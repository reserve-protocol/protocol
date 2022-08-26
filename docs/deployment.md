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

## Overall Deployment

The deployment process consists of two steps:

1. Deploy everything:

```
hardhat run scripts/deploy_all.ts --network {NETWORK}
```

If anything _does_ go wrong, the easiest thing to do is comment out the sub-scripts in `deploy_all.ts` in order to pick up execution at another point.

2. Verify everything:

```
hardhat run scripts/verify_all.ts --network {NETWORK}
```

The verification scripts are smart enough to only verify those that are unverified.

### Deploy Phases

Within the _deployment_ step, there are 3 phases:

- **Phase 1 - Common:** Required to deploy the core components of the Reserve Protocol. This includes required Solidity libraries, the implementation contracts of each system component, and some auxiliary components as the `Facade`, `Deployer`, and `FacadeWrite` contracts. This deployment phase has to be executed only **once** for all RTokens. Scripts are located in `/scripts/deployment/phase1-common`.

- **Phase 2 - Assets/Collateral:** Required to deploy new asset and collateral contracts that will be used for the deployment of a new RToken. The exact setup to deploy will depend on each case and can be customized for each particular RToken. Once an asset/collateral is deployed it can be reused for several RTokens. Scripts are located in `scripts/deployment/phase2-assets-collateral`.

- **Phase 3 - RToken:** Deployments are done via public functions in the `FacadeWrite` contract to simulate the Register. The RToken and Governance are left bricked, so as only to be only used for etherscan verification. Scripts are located in `scripts/deployment/phase3-rtoken`.

The same scripts can be executed against a Testnet or Mainnet network. Make sure the correct network is specified when executing the scripts (eg:`--network mainnet`)

A specific set of files will be created for that specific network after each phase:

1. `{CHAIN_ID}-tmp-deployments.json`: Contains prerequisite + implementation addresses
2. `{CHAIN_ID}-tmp-assets-collateral.json`: Contains asset plugin addresses
3. `{CHAIN_ID}-{RTOKEN_SYMBOL}-tmp-deployments.json`: Contains the (proxied) addresses that make up the real runtime system

### Verification

Verification sometimes fails when we do `verify_all`, but not when we run individual scripts. If this happens, run individual scripts directly, say, with: `hardhat run scripts/verification/6_verify_collateral.ts --network {NETWORK}`

### With Mainnet forking

- Before running the `deploy_all` script (or any particular script), run in a separate terminal a local forking node:

```bash
FORK=true npx hardhat node
```
