import fs from 'fs'
import hre from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getRTokenConfig, RTOKEN_NAME } from './rTokenConfig'
import {
  fileExists,
  getDeploymentFile,
  getDeploymentFilename,
  getRTokenDeploymentFilename,
  IDeployments,
  IRTokenDeployments,
} from '../common'
import { validatePrerequisites } from '../utils'

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
  if (chainId != '31337' && fileExists(rTokenDeploymentFilename)) {
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
    rTokenAsset: '',
    governance: '',
    timelock: '',
  }

  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployment file created for RToken ${RTOKEN_NAME} in ${hre.network.name} (${chainId}):
    FacadeWrite: ${deployments.facadeWrite}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
