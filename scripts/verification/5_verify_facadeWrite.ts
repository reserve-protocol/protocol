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

  /** ******************** Verify FacadeWrite ****************************************/
  await verifyContract(
    chainId,
    deployments.facadeWrite,
    [deployments.deployer],
    'contracts/facade/FacadeWrite.sol:FacadeWrite'
  )

  /** ******************** Verify FacadeWriteLib ****************************************/
  await verifyContract(
    chainId,
    deployments.facadeWriteLib,
    [],
    'contracts/facade/lib/FacadeWriteLib.sol:FacadeWriteLib'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
