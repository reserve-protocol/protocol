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

### Gas costs

Gas costs from Goerli; excludes collateral deployments:

- RSRAsset: 893,122
- RewardableLib: 918,407
- TradingLib: 2,623,625
- RTokenPricingLib: 842,435
- OracleLib: 448,042
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

## Mainnet Deployment Checklist / Instructions

### Generate the deployment key + init local .env

Do NOT screenshare this part!

It's important that nobody know the deployment key between steps 1 and 2 of the FacadeWrite, known as `phase3-rtoken/1_deploy_rtoken.ts` and `phase3-rtoken/2_deploy_governance.ts` in our scripts. But beyond this, we do not require the deployment key to be highly secured. The key will need to hold a decent amount of ETH in order to pay for deployment (estimate: at least 3 ETH at 30 gwei) and we certainly do not want someone to come in and snipe our deployment between the FacadeWrite steps, causing us to have to start the FacadeWrite steps again.

First, make sure you have golang setup on your machine. If you don't, here are the quick steps:

- Download from here: https://go.dev/doc/install
- Run the package install - confirm `go version` prints something
- Add to your bash profile: (i) `export GOPATH=$HOME/go` and (ii) `export PATH=$PATH:$GOPATH/bin`

Next, delete your local .env file (or rename, temporarily) and run the following from the project root:

```
go install github.com/kubetrail/bip39@latest
bip39 gen > .env.new
```

Finally, confirm you have a local file `.env.new` that contains a mnemonic.

### Finalize local .env file

[Still not screensharing]

To complete the .env configuration:

1. Open your local `.env.new` file and set `MNEMONIC` equal to the generated seed phrase.
1. Add a second entry for `MAINNET_RPC_URL` to be an RPC endpoint, probably from alchemy/infura.
1. Add a third entry for `ETHERSCAN_API_KEY`. Note this is _just_ the key, not the whole url.

Our new environment configuration is ready to go, rename it to `.env` with:

```
mv .env.new .env
```

End state: You have a `.env` file that contains setters for three environment variables. You did all of this without screensharing.

### Funding

[Screensharing ok]

At this point we're ready to run our scripts. Check to make sure the mnemonic is being processed correctly by attempting to run the deploy_all script:

```
hardhat run scripts/deploy_all.ts --network mainnet
```

It should error out complaining about not having enough gas. It will print a wallet address.

1. Look up the address on etherscan and confirm it is fresh
2. Send at least 6 ETH to the address. Wait until etherscan shows the new balance to proceed.

End state: You have a funded deployment account and are ready to proceed.

### Deploy!

[Screensharing ok]

Run the deploy_all script again, this time for real:

```
hardhat run scripts/deploy_all.ts --network mainnet
```

It should manage itself fairly well. On Goerli the overall process fell over multiple times, but I expect this is due to Goerli having generally weaker assurances and being less well-resourced overall. If mainnet also presents issues, we can easily pick up execution at the same part in the script by commenting out the relevant lines in `scripts/deploy_all.ts`. Avoid executing the same underlying deployment script multiple times in order to save on gas.

Three files should be produced as a result of this process.

- `1-tmp-deployments.json`
- `1-tmp-assets-collateral.json`
- `1-RTKN-tmp-deployments.json`

End state: All three files contain populated JSON objects. There should not be any empty string entries.

### Verify

[Screensharing ok]

Next, run:

```
hardhat run scripts/verify_all.ts --network mainnet
```

`verify_all.ts` works a bit differently than `deploy_all.ts`; inner scripts do not need to be commented out at all because verification is smart enough to skip over contracts that have already been verified.

It may be that `verify_all.ts` needs to be run multiple times in order to get 100% of the verifications. If an underlying script is presenting issues consistently, I found on Goerli that running it directly sometimes changed the outcome.

End state: All addresses that are in the generated output files are verified on etherscan. Check this manually. Also: check the staticAToken contracts, which themselves are not tracked but can be found by grabbing the ERC20 of the collateral.
