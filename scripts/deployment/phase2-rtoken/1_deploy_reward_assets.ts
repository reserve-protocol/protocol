import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { ITokens, networkConfig } from '../../../common/configuration'
import { getRTokenConfig } from './rTokenConfig'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getRTokenDeploymentFilename,
  IDeployments,
  IRTokenDeployments,
  validatePrerequisites,
} from '../deployment_utils'
import { Asset } from '../../../typechain'

// Define the Token to deploy - Will create deployment file
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(`Deploying Reward Assets for RToken ${rTokenConf.symbol} to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check prerequisites
  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validatePrerequisites(deployments)

  // Check previous step completed
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  const rTokenDeployments = <IRTokenDeployments>getDeploymentFile(rTokenDeploymentFilename)

  // Check FacadeWrite available
  if (!rTokenDeployments.facadeWrite) {
    throw new Error(`Missing FacadeWrite in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rTokenDeployments.facadeWrite))) {
    throw new Error(`FacadeWrite contract not found in network ${hre.network.name}`)
  }

  // Cleanup file
  rTokenDeployments.rewardAssets = []

  /********  Deploy Reward Assetss with Burner **************************/
  for (const assetInfo of rTokenConf.rewardAssets) {
    // Get type
    const assetType = assetInfo.split('-')[0]
    const assetName = assetInfo.split('-')[1] as keyof ITokens

    // TODO: if its an Ethereum address just use it directly - skip deploy

    // Check address correctly defined
    if (!networkConfig[chainId].tokens[assetName]) {
      throw new Error(`Missing configuration for ${assetName} in network: ${hre.network.name}`)
    }

    if (assetType == 'aave') {
      const aaveAsset = <Asset>(
        await (
          await ethers.getContractFactory('StakedAaveAsset')
        ).deploy(
          networkConfig[chainId].tokens[assetName] as string,
          rTokenConf.params.maxTradeVolume,
          deployments.prerequisites.COMPTROLLER,
          deployments.prerequisites.AAVE_LENDING_POOL
        )
      )
      await aaveAsset.deployed()
      rTokenDeployments.rewardAssets.push(aaveAsset.address)
    } else if (assetType == 'compound') {
      const compAsset = <Asset>(
        await (
          await ethers.getContractFactory('CompoundPricedAsset')
        ).deploy(
          networkConfig[chainId].tokens[assetName] as string,
          rTokenConf.params.maxTradeVolume,
          deployments.prerequisites.COMPTROLLER
        )
      )
      await compAsset.deployed()
      rTokenDeployments.rewardAssets.push(compAsset.address)
    } else {
      throw new Error(`Invalid asset type: ${assetType}`)
    }
  }

  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployed for RToken ${RTOKEN_NAME} to ${hre.network.name} (${chainId}):
    Reward Assets: ${rTokenDeployments.rewardAssets}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
