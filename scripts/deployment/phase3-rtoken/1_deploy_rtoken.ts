import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { IRTokenConfig, IRTokenSetup, networkConfig } from '../../../common/configuration'
import { getRTokenConfig, RTOKEN_NAME } from './rTokenConfig'
import { expectInIndirectReceipt } from '../../../common/events'
import { bn, fp } from '../../../common/numbers'
import {
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IAssetCollDeployments,
  IRTokenDeployments,
} from '../common'
import { AssetRegistryP1, DeployerP1, FacadeWrite, MainP1 } from '../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [deployerUser] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(`Deploying RToken ${rTokenConf.symbol} to network ${hre.network.name} (${chainId})
  with deployer account: ${deployerUser.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check previous step completed
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  const rTokenDeployments = <IRTokenDeployments>getDeploymentFile(rTokenDeploymentFilename)

  // Get deployed assets/collateral
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  // Get configuration
  const rTokenConfig: IRTokenConfig = {
    name: rTokenConf.name,
    symbol: rTokenConf.symbol,
    mandate: rTokenConf.mandate,
    params: rTokenConf.params,
  }

  const rTokenSetup: IRTokenSetup = {
    assets: [
      assetCollDeployments.assets.stkAAVE as string,
      assetCollDeployments.assets.COMP as string,
    ],
    primaryBasket: [
      assetCollDeployments.collateral.DAI as string,
      assetCollDeployments.collateral.aDAI as string,
      assetCollDeployments.collateral.cDAI as string,
    ],
    weights: [fp('0.25'), fp('0.25'), fp('0.5')],
    backups: [
      {
        backupUnit: ethers.utils.formatBytes32String('USD'),
        diversityFactor: bn(1),
        backupCollateral: [assetCollDeployments.collateral.USDC as string],
      },
    ],
    // doesn't matter what this is since it won't get used
    beneficiaries: [
      {
        beneficiary: deployerUser.address,
        revShare: {
          rTokenDist: bn('1'),
          rsrDist: bn('0'),
        },
      },
    ],
  }

  // Validate assets
  for (const assetAddr of rTokenSetup.assets) {
    if (!(await isValidContract(hre, assetAddr))) {
      throw new Error(`Asset contract not found in network ${hre.network.name}`)
    }
  }

  // Validate collaterals
  let allCollateral: string[] = rTokenSetup.primaryBasket
  for (const bkpInfo of rTokenSetup.backups) {
    allCollateral = allCollateral.concat(bkpInfo.backupCollateral)
  }
  for (const collAddr of allCollateral) {
    if (!(await isValidContract(hre, collAddr))) {
      throw new Error(`Collateral contract not found in network ${hre.network.name}`)
    }
  }

  // ******************** Deploy RToken ****************************************/
  const facadeWrite = <FacadeWrite>(
    await ethers.getContractAt('FacadeWrite', rTokenDeployments.facadeWrite)
  )
  const deployer = <DeployerP1>(
    await ethers.getContractAt('DeployerP1', await facadeWrite.deployer())
  )

  // Deploy RToken
  const receipt = await (await facadeWrite.deployRToken(rTokenConfig, rTokenSetup)).wait()

  // Get Main
  const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
  const main: MainP1 = <MainP1>await ethers.getContractAt('MainP1', mainAddr)
  const rTokenAddr = await main.rToken()

  // Get Assets deployed
  const assetRegistry: AssetRegistryP1 = <AssetRegistryP1>(
    await ethers.getContractAt('AssetRegistryP1', await main.assetRegistry())
  )
  const rTokenAssetAddr = await assetRegistry.toAsset(rTokenAddr)

  // Get addresses of other components
  const backingManagerAddr = await main.backingManager()
  const basketHandlerAddr = await main.basketHandler()
  const brokerAddr = await main.broker()
  const distributorAddr = await main.distributor()
  const furnaceAddr = await main.furnace()
  const rTokenTraderAddr = await main.rTokenTrader()
  const rsrTraderAddr = await main.rsrTrader()
  const stRSRAddr = await main.stRSR()

  rTokenDeployments.main = main.address
  rTokenDeployments.components.assetRegistry = assetRegistry.address
  rTokenDeployments.components.backingManager = backingManagerAddr
  rTokenDeployments.components.basketHandler = basketHandlerAddr
  rTokenDeployments.components.broker = brokerAddr
  rTokenDeployments.components.distributor = distributorAddr
  rTokenDeployments.components.furnace = furnaceAddr
  rTokenDeployments.components.rToken = rTokenAddr
  rTokenDeployments.components.rTokenTrader = rTokenTraderAddr
  rTokenDeployments.components.rsrTrader = rsrTraderAddr
  rTokenDeployments.components.stRSR = stRSRAddr
  rTokenDeployments.rTokenAsset = rTokenAssetAddr

  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployed for RToken ${RTOKEN_NAME} in ${hre.network.name} (${chainId})
    Main: ${main.address}
    AssetRegistry:  ${assetRegistry.address}
    BackingManager:  ${backingManagerAddr}
    BasketHandler:  ${basketHandlerAddr}
    Broker:  ${brokerAddr}
    Distributor:  ${distributorAddr}
    Furnace:  ${furnaceAddr}
    RToken:  ${rTokenAddr}
    RTokenTrader:  ${rTokenTraderAddr}
    RSRTrader:  ${rsrTraderAddr}
    stRSR:  ${stRSRAddr}
    RToken Asset:  ${rTokenAssetAddr}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
