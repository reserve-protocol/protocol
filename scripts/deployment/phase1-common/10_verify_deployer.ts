import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment_utils'

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
  console.time('Verifying Deployer')
  await hre.run('verify:verify', {
    address: deployments.deployer,
    constructorArguments: [
      deployments.prerequisites.RSR,
      deployments.prerequisites.GNOSIS_EASY_AUCTION,
      deployments.prerequisites.COMPTROLLER,
      deployments.prerequisites.AAVE_LENDING_POOL,
      deployments.facade,
      deployments.implementations,
    ],
    contract: 'contracts/p1/Deployer.sol:DeployerP1',
  })
  console.timeEnd('Verifying Deployer')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
