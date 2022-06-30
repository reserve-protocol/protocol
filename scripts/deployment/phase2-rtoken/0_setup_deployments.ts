import fs from 'fs'
import hre from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getRTokenConfig } from './rTokenConfig'
import {
  fileExists,
  getDeploymentFile,
  getDeploymentFilename,
  getRTokenDeploymentFilename,
  IDeployments,
  IRTokenDeployments,
  validatePrerequisites,
} from '../deployment_utils'

// Define the Token to deploy - Will create deployment file
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ==== Read Configuration ====
  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(
    `Creating Deployment file for RToken ${rTokenConf.symbol} in network ${hre.network.name} (${chainId})`
  )

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check if deployment file already exists for this chainId
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  if (fileExists(rTokenDeploymentFilename)) {
    throw new Error(`${rTokenDeploymentFilename} exists; I won't overwrite it.`)
  }

  // Validate previous deployment
  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validatePrerequisites(deployments)

  // Check FacadeWrite is deployed
  if (!deployments.facadeWrite) {
    throw new Error(`Missing FacadeWrite address in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.facadeWrite))) {
    throw new Error(`FacadeWrite contract not found in network ${hre.network.name}`)
  }

  // Get Owner
  const ownerAddr = rTokenConf.owner
  if (!ownerAddr) {
    throw new Error(`Missing address for Owner in network ${hre.network.name}`)
  } else {
    console.log(`Ownership will be transferred to account:  ${ownerAddr}`)
  }

  // ********************* Output Configuration******************************
  const rTokenDeployments: IRTokenDeployments = {
    facadeWrite: deployments.facadeWrite,
    main: '',
    components: {
      assetRegistry: '',
      backingManager: '',
      basketHandler: '',
      broker: '',
      distributor: '',
      furnace: '',
      rsrTrader: '',
      rTokenTrader: '',
      rToken: '',
      stRSR: '',
    },
    rsrAsset: '',
    rTokenAsset: '',
    rewardAssets: [],
    owner: ownerAddr,
    governance: '',
    timelock: '',
    collateral: {}
  }

  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployment file created for RToken ${RTOKEN_NAME} in ${hre.network.name} (${chainId}):
    FacadeWrite: ${deployments.facadeWrite}
    Owner: ${ownerAddr}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
