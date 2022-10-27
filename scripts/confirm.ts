/* eslint-disable no-process-exit */
import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { developmentChains, networkConfig } from '../common/configuration'
import { sh } from './deployment/utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  getDeploymentFilename,
} from './deployment/common'

async function main() {
  const chainId = await getChainId(hre)

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot confirm contracts for development chain ${hre.network.name}`)
  }

  const phase1Deployments = <IDeployments>getDeploymentFile(getDeploymentFilename(chainId))
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)
  if (!phase1Deployments || !assetDeployments) throw new Error('Missing deployments')

  console.log(`Starting confirmation on network ${hre.network.name} (${chainId})`)

  // Part 2/3 of the *overall* deployment process: Confirmation

  const scripts = ['0_confirm_components.ts', '1_confirm_assets.ts']

  for (const script of scripts) {
    console.log('\n===========================================\n', script, '')
    await sh(`hardhat run scripts/confirmation/${script}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
