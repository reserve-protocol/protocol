import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'

// Define the Token to deploy
const RTOKEN_NAME = 'RTKN'

let deployments: IRTokenDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  deployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  /** ******************** Verify RToken  ****************************************/
  console.time('Verifying RToken')
  // Check in Testnet if Contracts have been verified automqtically. May require to confirm in Etherscan.

  // Do this for all components

  // Also verify assets creared (RSR and RTOKEN)

  /** ******************** Verify Components  ****************************************/
  // Get all components and verify proxies - Needs to be tested in Testnet to confirm correct validation by default
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})