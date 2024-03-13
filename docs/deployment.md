# Deploying our Smart Contracts

Mostly, this is about _test_ deployment, though the same elements should work to deploy to any network once configured.

Real mainnet deployment, though, will entail a deployment checklist (see below) and serious operational security considerations (not yet articulated).

## Configure Environment

First, make sure your local environment configuration, in `.env`, is actually filled out. (`.env` is git-ignored; don't force-commit it somehow!)

```json
# Mnemonic, first address will be used for deployments
MNEMONIC=""

# Ropsten Infura URL, used for Testnet deployments
ROPSTEN_RPC_URL=""

# Goerli Infura URL, used for Testnet deployments
GOERLI_RPC_URL=""

# Base Goerli URL
BASE_GOERLI_RPC_URL=""

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

The deployment process consists of three high-level commands:

1. Deploy everything:

```
hardhat run scripts/deploy.ts --network {NETWORK}
OR
yarn deploy:run --network {NETWORK}
```

If anything _does_ go wrong, the easiest thing to do is comment out the sub-scripts in `deploy.ts` in order to pick up execution at another point.

2. Confirm the deployment:

```
hardhat run scripts/confirm.ts --network {NETWORK}
OR
yarn deploy:run:confirm --network {NETWORK}
```

3. Verify everything on Etherscan:

```
hardhat run scripts/verify_etherscan.ts --network {NETWORK}
OR
yarn verify_etherscan --network {NETWORK}
```

The verification scripts are smart enough to only verify those that are unverified.

### Deploy Phases

Within the _deployment_ step (step 1 from above), there are 3 phases:

- **Phase 1 - Common:** Required to deploy the core components of the Reserve Protocol. This includes required Solidity libraries, the implementation contracts of each system component, and some auxiliary components as the `Facade`, `Deployer`, and `FacadeWrite` contracts. This deployment phase has to be executed only **once** for all RTokens. Scripts are located in `/scripts/deployment/phase1-common`.

- **Phase 2 - Assets/Collateral:** Required to deploy new asset and collateral contracts that will be used for the deployment of a new RToken. The exact setup to deploy will depend on each case and can be customized for each particular RToken. Once an asset/collateral is deployed it can be reused for several RTokens. Scripts are located in `scripts/deployment/phase2-assets-collateral`.

- **Phase 3 - RToken:** Deployments are done via public functions in the `FacadeWrite` contract to simulate the Register. The RToken and Governance are left bricked, so as only to be only used for etherscan verification. Scripts are located in `scripts/deployment/phase3-rtoken`.

The same scripts can be executed against a Testnet or Mainnet network. Make sure the correct network is specified when executing the scripts (eg:`--network mainnet`)

A specific set of files will be created for that specific network after each phase:

1. `{CHAIN_ID}-tmp-deployments.json`: Contains prerequisite + implementation addresses
2. `{CHAIN_ID}-tmp-assets-collateral.json`: Contains asset plugin addresses
3. `{CHAIN_ID}-{RTOKEN_SYMBOL}-tmp-deployments.json`: Contains the (proxied) addresses that make up the real runtime system

### With Mainnet forking

- Before running the `deploy` script (or any particular script), run in a separate terminal a local forking node:

```bash
yarn devchain
```

### Gas costs

Gas costs from Goerli; excludes collateral deployments:
(ROUGH, these were last updated August 2022)

- RSRAsset: 893,122
- RewardableLib: 918,407
- TradingLib: 2,623,625
- Facade: 3,715,055
- FacadeWriteLib: 4,235,169
- FacadeWrite: 4,159,216
- Deployer: 3,366,347
- Main implementation: 1,908,322
- GnosisTrade implementation: 1,908,322
- AssetRegistry implementation: 2,061,194
- BackingManager implementation: 4,437,559
- BasketHandler implementation: 4,142,467
- Broker implementation: 1,648,334
- Distributor implementation: 1,778,246
- Furnace implementation: 1,588,099
- RevenueTrader implementation: 2,473,889
- StRSR implementation: 5,069,366
- RToken implementation: 5,372,794
- RToken instance deployment: 6,840,650
- Governance (/w timelock) instance deployment: 5,583,287

Total: ~66M gas

## Mainnet Deployment Instructions

First, clear any stale `*-tmp-*.json` deployment files if it's important for the entire script to run in one go, such as on a Mainnet deployment.

4 phases

1. Generate the deployment key
2. Finalize .env file
3. Deploy
4. Verify

### Generate the deployment key

Do NOT screenshare this part!

It's important that nobody knows the deployment key between steps 1 and 2 of the FacadeWrite: `phase3-rtoken/1_deploy_rtoken.ts` and `phase3-rtoken/2_deploy_governance.ts`. But beyond this, we do not require the deployment key to be highly secured. The key will need to hold a decent amount of ETH in order to pay for deployment (estimate: at minimum 3 ETH at 30 gwei) and we certainly do not want someone to come in and snipe our deployment between the FacadeWrite steps, causing us to have to start the FacadeWrite steps again.

First, make sure you have golang setup on your machine. If you don't, here are the quick steps:

- Download from here: https://go.dev/doc/install
- Run the package install - confirm `go version` prints something
- Add to your bash profile: (i) `export GOPATH=$HOME/go` and (ii) `export PATH=$PATH:$GOPATH/bin`

Next, navigate to the project root and (optional) save your local `.env` file before we clobber it. If you don't care about your prior `.env` file, you can ignore this.

Then

```
go install https://github.com/reserve-protocol/tiny39@latest
tiny39 > .env
```

Confirm you have a local file `.env` that contains the newly generated mnemonic. Send this over signal to other close members on the team. This may be necessary to sign messages from the deployer key in the future.

End state: You have a `.env` file that contains a seed phrase, and this seed phrase has been shared securely.

### Finalize .env file

[Still not screensharing]

To complete the environment configuration:

1. Open your local `.env` file in an editor
1. Add a second entry for `MAINNET_RPC_URL` to be an RPC endpoint, probably from alchemy/infura.
1. Add a third entry for `ETHERSCAN_API_KEY`. Note this is _just_ the key, not the whole url.

Finally, run the `check_env` script in order to confirm the 3 environment variables are configured correctly.

```
yarn deploy:check_env --network mainnet
```

If this passes successfully it will print the deployer address and the current ETH balance. Next:

1. Send at least 6 ETH to this address (check ethgasstation.info; if gas prices are > 30gwei then we may need more)
2. Close the current terminal session.

End state: Your `.env` file is known to be good. You did all of this without screensharing and are now at the end of the private-portion of the deployment process.

### Deploy

[Screensharing ok]

Open a new terminal session and from the project root run the deploy script:

```
yarn deploy:run --network mainnet
```

Three files should be produced as a result of this process.

- `1-tmp-deployments.json`
- `1-tmp-assets-collateral.json`
- `1-RTKN-tmp-deployments.json`

End state: All three files contain populated JSON objects. There should not be any empty string entries in any of the files. All 3 files should exist.

### Confirm

[Screensharing ok]

Next, run:

```
yarn deploy:run:confirm --network mainnet
```

This checks that:

- For each asset, confirm:
- `main.tradingPaused()` and `main.issuancePaused()` are true
- `timelockController.minDelay()` is > 1e12

End state: All addresses are verified, the contracts are in the correct state, and it's time to verify the contracts on Etherscan.

### Verify on Etherscan

[Screensharing ok]

Next, run:

```
yarn verify_etherscan --network mainnet
```

`verify_etherscan.ts` works a bit differently than `deploy.ts`; verification is smart enough to skip over contracts that have already been verified.

It may be that `verify_etherscan` needs to be run multiple times in order to get 100% of the verifications. If an underlying script is presenting issues consistently, I found on Goerli that running it directly sometimes changed the outcome.

Manual verification steps:

- For each address in the output files, make sure it is verified on Etherscan.
- Make sure the staticATokens are verified too. These are not directly in the output file. To do this you'll need to look at the ATokenCollateral plugins and read out their erc20 addresses, which will be the staticATokens.
