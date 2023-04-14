import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment/common'
import { verifyContract } from '../deployment/utils'

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

  /** ******************** Verify FacadeRead ****************************************/
  await verifyContract(
    chainId,
    deployments.facadeRead,
    [],
    'contracts/facade/FacadeRead.sol:FacadeRead'
  )

  /** ******************** Verify FacadeMonitor ****************************************/
  await verifyContract(
    chainId,
    deployments.facadeMonitor,
    [],
    'contracts/facade/FacadeMonitor.sol:FacadeMonitor'
  )

  /** ******************** Verify FacadeAct ****************************************/
  await verifyContract(
    chainId,
    deployments.facadeAct,
    [],
    'contracts/facade/FacadeAct.sol:FacadeAct'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
