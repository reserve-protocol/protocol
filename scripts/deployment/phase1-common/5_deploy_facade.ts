import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { IComponents, networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments, validateImplementations } from '../deployment_utils'
import { FacadeP1 } from '../../../typechain'

let facade: FacadeP1

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Deployer to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments =  <IDeployments> getDeploymentFile(deploymentFilename)

  await validateImplementations(deployments)

  // ******************** Deploy Facade ****************************************/
  const FacadeFactory = await ethers.getContractFactory('FacadeP1')
  facade = <FacadeP1>await FacadeFactory.connect(burner).deploy()
  await facade.deployed()

  // Write temporary deployments file
  deployments.facade = facade.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    Facade:  ${facade.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
