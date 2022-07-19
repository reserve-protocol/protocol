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

  /** ******************** Verify FacadeWrite ****************************************/
  console.time('Verifying FacadeWrite')
  await hre.run('verify:verify', {
    address: deployments.facadeWrite,
    constructorArguments: [],
    contract: 'contracts/FacadeWrite.sol:FacadeWrite',
  })
  console.timeEnd('Verifying FacadeWrite')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
