import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { validateImplementations } from '../utils'
import { DeployerP1 } from '../../../typechain'

let deployer: DeployerP1

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
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  // Validate implementations
  await validateImplementations(deployments)

  // Check previous step executed
  if (!deployments.facade) {
    throw new Error(`Missing deployed contracts in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.facade))) {
    throw new Error(`Facade contract not found in network ${hre.network.name}`)
  }

  // ******************** Deploy Deployer ****************************************/
  const DeployerFactory = await ethers.getContractFactory('DeployerP1')
  deployer = <DeployerP1>(
    await DeployerFactory.connect(burner).deploy(
      deployments.prerequisites.RSR,
      deployments.prerequisites.GNOSIS_EASY_AUCTION,
      deployments.rsrAsset,
      deployments.implementations
    )
  )
  await deployer.deployed()

  // Write temporary deployments file
  deployments.deployer = deployer.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    Deployer:  ${deployer.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
