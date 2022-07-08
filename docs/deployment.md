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

## Deployment process - Using Mainnet forking

* Run in a separate terminal a local forking node following the instructions above.

```bash
FORK=true npx hardhat node
```

The deploymen process consists of three main phases. The scripts required for each phase are located in the `scripts/deployment` folder.

* **Phase 1 - Common:** Required to deploy the core components of the Reserve Protocol. This includes required Solidity libraries, the implementation contracts of each system component, and some auxiliary components as the `Facade`, `Deployer`, and `FacadeWrite` contracts. This deployment phase has to be executed only once for all RTokens. Scripts are located in `deployments/scripts/phase1-common`.

* **Phase 2 - Assets/Collareral:** Required to deploy new asset and collateral contracts that will be used for the deployment of a new RToken. The exact setup to deploy will depend on each case and can be customized for each particular RToken. Once an asset/collateral is deployed it can be reused for several RTokens. Scripts are located in `deployments/scripts/phase2-assets-collateral`.

* **Phase 3 - RToken:**  Required to deploy a new RToken. Uses a configuration file and can be customized with the required parameters. Deployments are done via public functions in the `FacadeWrite` contract. Scripts are located in `deployments/scripts/phase3-rtoken`.


### Phase 1 - Common Components

* In a separate terminal you will need to run the following scripts:

**0.Setup Deployments:** Run the script which creates the deployment file and validates configuration prerequisites. Make sure the addresses for required contracts are properly configured in `common\configuration.ts` with the Mainnet address. 

This will create a local `31337-tmp-deployments.json` file with the corresponding addresses. Do not delete or modify this file as it wil be used for later scripts

```bash
npx hardhat run scripts/deployment/phase1-common/0_setup_deployments.ts --network localhost
```

**1.Deploy Libraries:** Run the script which deploys the *RewardableLib* and *TradingLib* libraries. This will update the *TradingLib* and *RewardableLib* addresses in the local `31337-tmp-deployments.json` file.

```bash
npx hardhat run scripts/deployment/phase1-common/1_deploy_libraries.ts --network localhost
```

**2.Verify Libraries (only testnet/mainnet):** Run the script to verify the libraries recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase1-common/2_verify_libraries.ts --network localhost
```

**3.Deploy Implementations:** Run the script which deploys the component immplementations (*Main*, *Trade*, *AssetRegistry*, *BackingManager*, etc). This will update the compoment implementation addresses in the local `31337-tmp-deployments.json` file.

```bash
npx hardhat run scripts/deployment/phase1-common/3_deploy_implementations.ts --network testnet/mainnet
```

**4.Verify Implementations (only testnet/mainnet):** Run the script to verify the implementation contracts recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase1-common/4_verify_implementations.ts --network testnet/mainnet
```

**5.Deploy RSR Asset:** Run the script which deploys the *RSR asset* contract. This will update the *RSR Asset* address in the local `31337-tmp-deployments.json` file.

```bash
npx hardhat run scripts/deployment/phase1-common/5_deploy_rsrAsset --network localhost
```

**6.Verify RSR Asset (only testnet/mainnet):** Run the script to verify the RSR Asset contract recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase1-common/5_verify_rsrAsset.ts --network testnet/mainnet
```

**7.Deploy Facade:** Run the script which deploys the *Facade* contract. This will update the *Facade* address in the local `31337-tmp-deployments.json` file.

```bash
npx hardhat run scripts/deployment/phase1-common/7_deploy_facade --network localhost
```

**8.Verify Facade (only testnet/mainnet):** Run the script to verify the Facade contract recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase1-common/8_verify_facade.ts --network testnet/mainnet
```

**9.Deploy Deployer:** Run the script which deploys the *Deployer* contract. This will update the *Deployer* address in the local `31337-tmp-deployments.json` file.

```bash
npx hardhat run scripts/deployment/phase1-common/9_deploy_deployer --network localhost
```

**10.Verify Deployer (only testnet/mainnet):** Run the script to verify the Deployer contract recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase1-common/10_verify_deployer.ts --network testnet/mainnet
```

**11.Deploy FacadeWrite:** Run the script which deploys the *FacadeWrite* contract. This will update the *FacadeWrite* address in the local `31337-tmp-deployments.json` file.

```bash
npx hardhat run scripts/deployment/phase1-common/11_deploy_facadeWrite --network localhost
```
**12.Verify FacadeWrite (only testnet/mainnet):** Run the script to verify the FacadeWrite contract recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase1-common/12_verify_facadeWrite.ts --network testnet/mainnet
```

### Phase 2 - Assets/Collateral

This step is required in the case that new Assets and Collateral contracts need to be deployed. Scripts can be customized to parametrize and define the assets/collaterals to deploy.

A specific **task** is provided for each type of asset/collateral that needs to be deployed. These are:

* Asset: `/tasks/deployment/assets/deploy-asset`
* Fiat Collateral: `/tasks/deployment/collateral/deploy-fiat-collateral`
* Non-Fiat Collateral: `/tasks/deployment/collateral/deploy-nonfiat-collateral`
* Self-referential Collateral: `/tasks/deployment/collateral/deploy-selfreferential-collateral`
* AToken Fiat Collateral: `/tasks/deployment/collateral/deploy-atoken-fiat-collateral`
* CToken Fiat Collateral: `/tasks/deployment/collateral/deploy-ctoken-fiat-collateral`
* CToken Non-Fiat Collateral: `/tasks/deployment/collateral/deploy-ctoken-nonfiat-collateral`
* CToken Self-referential Collateral: `/tasks/deployment/collateral/deploy-ctoken-selfreferential-collateral`


Building a deployment script for Assets/Collateral implies bundling and parametrizing calls to these different tasks, depending on the particular needs of each RToken.

Run the following scripts in a separate terminal:

**0.Setup Assets/Collateral:** Run the script which creates the deployment file for assets and collateral. Make sure the token addresses for required contracts are properly configured in `common\configuration.ts` with the Mainnet address. 

This will create a local `31337-tmp-assets-collateral.json` file with the corresponding addresses. This can be used as a reference for subsequent RToken deployments.

```bash
npx hardhat run scripts/deployment/phase2-assets-collateral/0_setup_deployments.ts --network localhost
```

**1.Deploy Oracle Library:** Run the script which deploys the *OracleLib* library. This will update the *OracleLib* address in the local `31337-tmp-assets-collateral.json` file.

```bash
npx hardhat run scripts/deployment/phase2-assets-collateral/1_deploy_oracle_lib.ts --network localhost
```

**2.Deploy Assets:** Run the script which deploys the *Asset* contracts. Here you can *customize* the asset contracts to deploy. This will update the `assets` address in the local `31337-tmp-assets-collateral.json` file.

```bash
npx hardhat run scripts/deployment/phase2-assets-collateral/2_deploy_assets.ts --network localhost
```

**3.Deploy Collateral:** Run the script which deploys the *Collateral* contracts. Here you can *customize* the collateral contracts to deploy. This will update the `collateral` address in the local `31337-tmp-assets-collateral.json` file.

```bash
npx hardhat run scripts/deployment/phase2-assets-collateral/3_deploy_collateral.ts --network localhost
```

**4.Verify OracleLib (only testnet/mainnet):** Run the script to verify the OracleLib contract recently deployed. This step is not required for local development chains.

```bash
npx hardhat run scripts/deployment/phase2-assets-collateral/4_verify_oracle_lib.ts --network testnet/mainnet
```

* It is also recommended to verify the newly deployed assets/collateral once these steps are completed.

### Phase 3 - RToken

To deploy an *RToken* it is important to define a **symbol** to use and set the configuration for the required network in the `rTokenConfig.ts` file located in `scripts/deployment/phase3-rtoken`.

This **symbol** needs to be defined at the top of each script file to make sure the deployments are related to the previously defined configuration.

Run the following scripts in a separate terminal:

**0.Setup Deployments:** Run the script which creates the deployment file for a specific RToken. Make sure the configuration is properly defined in `rTokenConfig.ts` for the network address. 

This will create a local `31337-{RTOKEN SYMBOL}-tmp-deployments.json` file with the corresponding addresses. Do not delete or modify this file as it wil be used for later scripts

```bash
npx hardhat run scripts/deployment/phase3-rtoken/0_setup_deployments.ts --network localhost
```

**1.Deploy RToken:** Run the script which deploys the *RToken* contracts through the FacadeWrite interface. You can *customize* the assets/collateral to use in this script. This will update the local`31337-{RTOKEN SYMBOL}-tmp-assets-collateral.json` file with the new addresses.

```bash
npx hardhat run scripts/deployment/phase3-rtoken/1_deploy_rtoken.ts --network localhost
```


**2.Setup Governance:** Run the script which setups the governance settings for an *RToken* contract, through the FacadeWrite interface. You can *customize* the settings in the configuration file and also in the script. This will update the local`31337-{RTOKEN SYMBOL}-tmp-assets-collateral.json` file with the new addresses.

```bash
npx hardhat run scripts/deployment/phase3-rtoken/2_setup_governance.ts --network localhost
```

* It is also recommended to verify all the deployed components and contracts.


## Deploying to other networks

The same scripts can be executed against a Testnet or Mainnet network. Make sure the correct network is specified when executing the scripts (eg:`--network mainnet`)

Make sure contract addresses are properly configured for the desired network (`chainId = 1 or 3, etc`) in the `networkConfig` object.

A specific set of files will be creared for that specific network (using the network `chainId` as prefix)

