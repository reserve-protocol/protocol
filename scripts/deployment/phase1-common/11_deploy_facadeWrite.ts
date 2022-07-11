import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  validateImplementations,
} from '../deployment_utils'
import { FacadeWrite } from '../../../typechain'

let facadeWrite: FacadeWrite

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying FacadeWrite to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  // Validate implementations
  await validateImplementations(deployments)

  // Check previous step executed
  if (!deployments.deployer) {
    throw new Error(`Missing Deployer contract in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.deployer))) {
    throw new Error(`Deployer contract not found in network ${hre.network.name}`)
  }

  // ******************** Deploy FacadeWrite ****************************************/
  const FacadeWriteFactory = await ethers.getContractFactory('FacadeWrite')
  facadeWrite = <FacadeWrite>await FacadeWriteFactory.connect(burner).deploy(deployments.deployer)
  await facadeWrite.deployed()

  // Write temporary deployments file
  deployments.facadeWrite = facadeWrite.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    FacadeWrite:  ${facadeWrite.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})