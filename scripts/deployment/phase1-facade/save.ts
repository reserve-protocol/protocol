import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { initiateMultisigTxs } from '../utils'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Saving Facets to Facade on network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  // Check facade exists
  if (!deployments.facade) {
    throw new Error(`Missing deployed contracts in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.facade))) {
    throw new Error(`Facade contract not found in network ${hre.network.name}`)
  }

  // ******************** Save Facets to Facade ****************************************/

  if (hre.network.name == 'localhost' || hre.network.name == 'hardhat') {
    console.log('Skipping saving facets on localhost')
    return
  }

  const facade = await ethers.getContractAt('Facade', deployments.facade)

  const facets = [
    await ethers.getContractAt('ReadFacet', deployments.facets.readFacet),
    await ethers.getContractAt('ActFacet', deployments.facets.actFacet),
    await ethers.getContractAt('MaxIssuableFacet', deployments.facets.maxIssuableFacet),
    await ethers.getContractAt('BackingBufferFacet', deployments.facets.backingBufferFacet),
    await ethers.getContractAt('RevenueFacet', deployments.facets.revenueFacet),
  ]

  const txs = facets.map((facet): MetaTransactionData => {
    return {
      to: facade.address,
      value: '0',
      data: facade.interface.encodeFunctionData('save', [
        facet.address,
        Object.entries(facet.functions).map(([fn]) => facet.interface.getSighash(fn)),
      ]),
    }
  })

  await initiateMultisigTxs(chainId, txs)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
