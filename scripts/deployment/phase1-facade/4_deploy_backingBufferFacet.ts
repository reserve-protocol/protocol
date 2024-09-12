import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { BackingBufferFacet } from '../../../typechain'

import SafeApiKit from '@safe-global/api-kit'
import { getDevSafe } from '../utils'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'

let backingBufferFacet: BackingBufferFacet

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

  // ******************** Deploy BackingBufferFacet ****************************************/

  // Deploy BackingBufferFacet
  const BackingBufferFacetFactory = await ethers.getContractFactory('BackingBufferFacet')
  backingBufferFacet = <BackingBufferFacet>await BackingBufferFacetFactory.connect(burner).deploy()
  await backingBufferFacet.deployed()

  // Write temporary deployments file
  deployments.facets.backingBufferFacet = backingBufferFacet.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    BackingBufferFacet:  ${backingBufferFacet.address}
    Deployment file: ${deploymentFilename}`)

  // ******************** Save to Facade ****************************************/

  console.log('Configuring with Facade...')

  // Save BackingBufferFacet functions to Facade
  const facade = await ethers.getContractAt('Facade', deployments.facade)
  const tx: MetaTransactionData = {
    to: facade.address,
    value: '0',
    data: facade.interface.encodeFunctionData('save', [
      backingBufferFacet.address,
      Object.entries(backingBufferFacet.functions).map(([fn]) =>
        backingBufferFacet.interface.getSighash(fn)
      ),
    ]),
  }

  const safe = await getDevSafe(chainId)
  const safeApi = new SafeApiKit({
    chainId: parseInt(chainId) as unknown as bigint,
  })

  const safeTx = await safe.createTransaction({ transactions: [tx] })

  const safeTxHash = await safe.getTransactionHash(safeTx)
  const signature = await safe.signHash(safeTxHash)

  // Propose transaction to the service
  await safeApi.proposeTransaction({
    safeAddress: await safe.getAddress(),
    safeTransactionData: safeTx.data,
    safeTxHash,
    senderAddress: burner.address,
    senderSignature: signature.data,
  })

  console.log('Queued tx in Facade, requires confirmation. ')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
