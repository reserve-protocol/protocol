import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { validateImplementations } from '../utils'
import { ActFacet, Facade, ReadFacet } from '../../../typechain'

let facade: Facade

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

  // ******************** Deploy Facade ****************************************/

  // Deploy Facade
  const FacadeFactory: ContractFactory = await ethers.getContractFactory('Facade')
  const facade = await ethers.getContractAt('TestIFacade', (await FacadeFactory.deploy()).address)

  // Save ReadFacet to Facade
  const ReadFacetFactory: ContractFactory = await ethers.getContractFactory('ReadFacet')
  const readFacet = <ReadFacet>await ReadFacetFactory.deploy()
  await facade.save(
    readFacet.address,
    Object.entries(readFacet.functions).map(([fn]) => readFacet.interface.getSighash(fn))
  )

  // Save ActFacet to Facade
  const ActFacetFactory: ContractFactory = await ethers.getContractFactory('ActFacet')
  const actFacet = <ActFacet>await ActFacetFactory.deploy()
  await facade.save(
    actFacet.address,
    Object.entries(actFacet.functions).map(([fn]) => actFacet.interface.getSighash(fn))
  )

  return { facade }

  const FacadeFactory = await ethers.getContractFactory('FacadeRead')
  facadeRead = <FacadeRead>await FacadeFactory.connect(burner).deploy()
  await facadeRead.deployed()

  // Write temporary deployments file
  deployments.facadeRead = facadeRead.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    Facade:  ${facadeRead.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
