import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { validateImplementations } from '../utils'
import { FacadeWrite } from '../../../typechain'

let facadeWrite: FacadeWrite

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Facade to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validateImplementations(deployments)

  // Check previous step executed
  if (!deployments.rsrAsset) {
    throw new Error(`Missing deployed contracts in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.rsrAsset))) {
    throw new Error(`RSR Asset contract not found in network ${hre.network.name}`)
  }

  // ******************** Deploy FacadeWrite ****************************************/

  // Deploy FacadeWriteLib
  const FacadeWriteLibFactory = await ethers.getContractFactory('FacadeWriteLib')
  const facadeWriteLib = await FacadeWriteLibFactory.connect(burner).deploy()
  await facadeWriteLib.deployed()

  // Deploy FacadeWrite
  const FacadeWriteFactory = await ethers.getContractFactory('FacadeWrite', {
    libraries: {
      FacadeWriteLib: facadeWriteLib.address,
    },
  })

  facadeWrite = <FacadeWrite>await FacadeWriteFactory.connect(burner).deploy(deployments.deployer)
  await facadeWrite.deployed()

  // Write temporary deployments file
  deployments.facadeWriteLib = facadeWriteLib.address
  deployments.facadeWrite = facadeWrite.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    FacadeWrite:  ${facadeWrite.address}
    FacadeWriteLib:  ${facadeWriteLib.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
