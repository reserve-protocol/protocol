import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getRTokenConfig } from '../deployment/phase3-rtoken/rTokenConfig'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
  IDeployments,
  fileExists,
} from '../deployment/common'
import { verifyContract } from '../deployment/utils'

let rTokenDeployments: IRTokenDeployments

// Define the Token to use
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  const phase1Deployment = <IDeployments>getDeploymentFile(phase1File)

  rTokenDeployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  /********************** Verify RTokenAsset ****************************************/
  await verifyContract(
    chainId,
    rTokenDeployments.rTokenAsset,
    [rTokenDeployments.components.rToken, rTokenConf.params.rTokenMaxTradeVolume],
    'contracts/plugins/assets/RTokenAsset.sol:RTokenAsset'
  )

  /******************* Verify the RToken's Proxy ****************************************/
  // Should handle all proxied contracts on etherscan for us
  await verifyContract(
    chainId,
    rTokenDeployments.components.rToken,
    [phase1Deployment.implementations.components.rToken, '0x'],
    '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
