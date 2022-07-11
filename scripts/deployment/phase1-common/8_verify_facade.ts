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

  /** ******************** Verify Facade ****************************************/
  console.time('Verifying Facade')
  await hre.run('verify:verify', {
    address: deployments.facade,
    constructorArguments: [],
    contract: 'contracts/Facade.sol:FacadeP1',
  })
  console.timeEnd('Verifying Facade')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
