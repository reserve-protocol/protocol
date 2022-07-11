import fs from 'fs'
import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import {
  fileExists,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment_utils'

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
  const deploymentFilename = getAssetCollDeploymentFilename(chainId)
  if (fileExists(deploymentFilename)) {
    throw new Error(`${deploymentFilename} exists; I won't overwrite it.`)
  }

  // ********************* Output Configuration******************************
  const deployments: IAssetCollDeployments = {
    oracleLib: '',
    assets: {},
    collateral: {},
  }
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployment file created for ${hre.network.name} (${chainId}):
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
