import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment/common'
import { verifyContract } from '../deployment/utils'

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
  await verifyContract(chainId, deployments.facade, [], 'contracts/facade/Facade.sol:Facade')

  /** ******************** Verify ReadFacet ****************************************/
  await verifyContract(
    chainId,
    deployments.facets.readFacet,
    [],
    'contracts/facade/facets/ReadFacet.sol:ReadFacet'
  )

  /** ******************** Verify ActFacet ****************************************/
  await verifyContract(
    chainId,
    deployments.facets.actFacet,
    [],
    'contracts/facade/facets/ActFacet.sol:ActFacet'
  )

  /** ******************** Verify MaxIssuableFacet ****************************************/
  await verifyContract(
    chainId,
    deployments.facets.maxIssuableFacet,
    [],
    'contracts/facade/facets/MaxIssuableFacet.sol:MaxIssuableFacet'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
