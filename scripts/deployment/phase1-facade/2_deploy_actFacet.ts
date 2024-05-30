import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { ActFacet } from '../../../typechain'

let actFacet: ActFacet

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying ActFacet to network ${hre.network.name} (${chainId})
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

  // ******************** Deploy ActFacet ****************************************/

  // Deploy ActFacet
  const ActFacetFactory = await ethers.getContractFactory('ActFacet')
  actFacet = <ActFacet>await ActFacetFactory.connect(burner).deploy()
  await actFacet.deployed()

  // Write temporary deployments file
  deployments.facets.actFacet = actFacet.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    ActFacet:  ${actFacet.address}
    Deployment file: ${deploymentFilename}`)

  // ******************** Save to Facade ****************************************/

  console.log('Configuring with Facade...')

  // Save ReadFacet to Facade
  const facade = await ethers.getContractAt('Facade', deployments.facade)
  await facade.save(
    actFacet.address,
    Object.entries(actFacet.functions).map(([fn]) => actFacet.interface.getSighash(fn))
  )

  console.log('Finished saving to Facade')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
