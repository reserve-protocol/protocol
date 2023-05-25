import fs from 'fs'
import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import {
  fileExists,
  getAssetCollDeploymentFilename,
  getDeploymentFilename,
  IAssetCollDeployments,
} from '../common'

async function main() {
  // ==== Read Configuration ====
  const chainId = await getChainId(hre)

  console.log(
    `Creating Assets/Collateral Deployment file for network ${hre.network.name} (${chainId})`
  )

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check if deployment file already exists for this chainId
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check if deployment file already exists for this chainId
  const deploymentFilename = getAssetCollDeploymentFilename(chainId)
  if (chainId != '31337' && fileExists(deploymentFilename)) {
    throw new Error(`${deploymentFilename} exists; I won't overwrite it.`)
  }

  // ********************* Output Configuration******************************
  const deployments: IAssetCollDeployments = {
    assets: {},
    collateral: {},
    erc20s: {},
  }
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployment file created for ${hre.network.name} (${chainId}):
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
