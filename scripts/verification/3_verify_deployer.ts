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

  /** ******************** Verify Deployer ****************************************/
  await verifyContract(
    chainId,
    deployments.deployer,
    [
      deployments.prerequisites.RSR,
      deployments.prerequisites.GNOSIS_EASY_AUCTION,
      deployments.facade,
      deployments.rsrAsset,
      deployments.implementations,
    ],
    'contracts/p1/Deployer.sol:DeployerP1',
    { RTokenPricingLib: deployments.rTokenPricingLib }
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
