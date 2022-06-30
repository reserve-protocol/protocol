import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import {
  ITokens,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
  IBackupInfo,
} from '../../../common/configuration'
import { getRTokenConfig } from './rTokenConfig'
import { expectInIndirectReceipt } from '../../../common/events'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'
import { AssetRegistryP1, DeployerP1, FacadeWrite, MainP1 } from '../../../typechain'

// Define the Token to deploy
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(`Deploying RToken ${rTokenConf.symbol} to network ${hre.network.name} (${chainId})
  with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check previous step completed
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  const rTokenDeployments = <IRTokenDeployments>getDeploymentFile(rTokenDeploymentFilename)

  // Validate Collaterals
  if (Object.keys(rTokenDeployments.collateral).length == 0) {
    throw new Error(`Missing collaterals in network ${hre.network.name}`)
  } else {
    for (const [, addr] of Object.entries(rTokenDeployments.collateral)) {
      if (!(await isValidContract(hre, addr))) {
        throw new Error(`Collateral contract not found in network ${hre.network.name}`)
      }
    }
  }

  // Validate Reward assets
  for (const assetAddr of rTokenDeployments.rewardAssets) {
    if (!(await isValidContract(hre, assetAddr))) {
      throw new Error(`Asset contract not found in network ${hre.network.name}`)
    }
  }

  // Get configuration
  const rTokenConfig: IRTokenConfig = {
    name: rTokenConf.name,
    symbol: rTokenConf.symbol,
    manifestoURI: rTokenConf.manifestoURI,
    params: rTokenConf.params,
  }

  // Process backups
  const bkpInfos: IBackupInfo[] = []
  for (const bkpInfo of rTokenConf.backups) {
    // Get backup collateral ercs20s
    const bkpCollaterals: string[] = []
    for (const bkpColl of bkpInfo.backupCollateral) {
      const collName = bkpColl.split('-')[1] as keyof ITokens
      const colAddr = rTokenDeployments.collateral[collName] || ''
      bkpCollaterals.push(colAddr)
    }

    bkpInfos.push({
      backupUnit: ethers.utils.formatBytes32String(bkpInfo.backupUnit),
      diversityFactor: bkpInfo.diversityFactor,
      backupCollateral: bkpCollaterals,
    })
  }

  // Get primary Basket Addrs
  const primaryBasketAddrs: string[] = []
  for (const bskColl of rTokenConf.primaryBasket) {
    const collName = bskColl.split('-')[1] as keyof ITokens
    const colAddr = rTokenDeployments.collateral[collName] || ''
    primaryBasketAddrs.push(colAddr)
  }

  // Set RToken setup
  const rTokenSetup: IRTokenSetup = {
    rewardAssets: rTokenDeployments.rewardAssets,
    primaryBasket: primaryBasketAddrs,
    weights: rTokenConf.weights,
    backups: bkpInfos,
  }

  // ******************** Deploy RToken ****************************************/
  const facadeWrite = <FacadeWrite>(
    await ethers.getContractAt('FacadeWrite', rTokenDeployments.facadeWrite)
  )
  const deployer = <DeployerP1>(
    await ethers.getContractAt('DeployerP1', await facadeWrite.deployer())
  )

  // Deploy RToken
  const receipt = await (
    await facadeWrite.deployRToken(rTokenConfig, rTokenSetup, rTokenDeployments.owner)
  ).wait()

  // Get Main
  const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
  const main: MainP1 = <MainP1>await ethers.getContractAt('MainP1', mainAddr)
  const rTokenAddr = await main.rToken()

  // Get Assets deployed
  const assetRegistry: AssetRegistryP1 = <AssetRegistryP1>(
    await ethers.getContractAt('AssetRegistryP1', await main.assetRegistry())
  )
  const rsrAssetAddr = await assetRegistry.toAsset(await main.rsr())
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
  rTokenDeployments.rsrAsset = rsrAssetAddr
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
    RSR Asset:  ${rsrAssetAddr}
    RToken Asset:  ${rTokenAssetAddr}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
