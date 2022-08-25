import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  verifyContract,
} from '../deployment/deployment_utils'

let deployments: IDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  deployments = <IDeployments>getDeploymentFile(getDeploymentFilename(chainId))

  /** ******************** Verify Facade ****************************************/
  await verifyContract(chainId, deployments.facade, [], 'contracts/facade/Facade.sol:FacadeP1')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
