import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { ReadFacet } from '../../../typechain'

let readFacet: ReadFacet

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

  // Check facade exists
  if (!deployments.facade) {
    throw new Error(`Missing deployed contracts in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.facade))) {
    throw new Error(`Facade contract not found in network ${hre.network.name}`)
  }

  // ******************** Deploy ReadFacet ****************************************/

  // Deploy ReadFacet
  const ReadFacetFactory = await ethers.getContractFactory('ReadFacet')
  readFacet = <ReadFacet>await ReadFacetFactory.connect(burner).deploy()
  await readFacet.deployed()

  // Write temporary deployments file
  deployments.facets.readFacet = readFacet.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    ReadFacet:  ${readFacet.address}
    Deployment file: ${deploymentFilename}`)

  // ******************** Save to Facade ****************************************/

  console.log('Configuring with Facade...')

  // Save ReadFacet to Facade
  const facade = await ethers.getContractAt('Facade', deployments.facade)
  await facade.save(
    readFacet.address,
    Object.entries(readFacet.functions).map(([fn]) => readFacet.interface.getSighash(fn))
  )

  console.log('Finished saving to Facade')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
