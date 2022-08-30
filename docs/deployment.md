# Deploying our Smart Contracts

Mostly, this is about _test_ deployment, though the same elements should work to deploy to any network once configured.

Real mainnet deployment, though, will entail an deployment checklist (see below) and serious operational security considerations (not yet articulated).

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

## Deployment Overview

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

### With Mainnet forking

- Before running the `deploy_all` script (or any particular script), run in a separate terminal a local forking node:

```bash
FORK=true npx hardhat node
```

## Mainnet Deployment Checklist / Instructions

### Init local .env file

Okay to screenshare this part

If you don't have one already, init a local `.env` file at the project root.

1. Configure `MAINNET_RPC_URL` to be an RPC endpoint, probably from alchemy/infura.
2. Configure `ETHERSCAN_API_KEY`. Note this is _just_ the key, not the whole url.

### Generate the deployment key

Do NOT screenshare this part!

It's important that nobody know the deployment key between steps 1 and 2 of the FacadeWrite, known as `phase3-rtoken/1_deploy_rtoken.ts` and `phase3-rtoken/2_deploy_governance.ts` in our scripts. But beyond this, we do not require the deployment key to be highly secured. The key will need to hold a decent amount of ETH in order to pay for deployment (estimate: ~3 ETH at 30 gwei) and we certainly do not want someone to come in and snipe our deployment between the FacadeWrite steps.

Current plan (matt to check):

- Go to https://github.com/iancoleman/bip39/releases/tag/0.5.4
- Download the `bip39-standalone.html`
- TODO: Verify the PGP signature? The code is open source and it has had tons of eyeballs on it.
- Open the standalone html app (ideally from a browser you do not normally use) and click **GENERATE**
- Copy the menomic string to a local `.env` file and set the variable `MNEMONIC` equal to it
- Change the _Coin_ dropdown to "Ethereum"
- Scroll down and copy the first address, which should be at path `m/44'/60'/0'/0/0`. Send about 6 ETH here, if targeting a gasprice of 30 gwei (legacy).
- Close the html app and browser

End state: You have a `.env` file that sets three environment variables, and nobody else knows the seed phrase. Etherscan says at least 6 ETH is at the expected address.

### Deploy!

From within the project root (which is where your `.env` file is located), run:

```
hardhat run scripts/deploy_all.ts --network mainnet
```

That's it!

Note: On Goerli the overall process fell over multiple times, but I expect this is due to Goerli having generally weaker assurances and being less well-resourced overall. If mainnet also presents issues, you can easily pick up execution at the same part in the script by commenting out the relevant lines in `scripts/deploy_all.ts`. Avoid executing the same underlying deployment script multiple times in order to save on gas.

Three files should be produced.

- `1-tmp-deployments.json`
- `1-tmp-assets-collateral.json`
- `1-RTKN-tmp-deployments.json`

After: Confirm there are no keys without assigned addresses.

### Verify

From within the project root (which is where your `.env` file is located), run:

```
hardhat run scripts/verify_all.ts --network mainnet
```

`verify_all.ts` works a bit differently than `deploy_all.ts`; inner scripts do not need to be commented out at all because verification is smart enough to skip over contracts that have already been verified.

It may be that `verify_all.ts` needs to be run multiple times in order to get 100% of the verifications. If an underlying script is presenting issues consistently, I found on Goerli that running it directly sometimes changed the outcome.
