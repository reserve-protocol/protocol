import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getRTokenConfig } from '../deployment/phase3-rtoken/rTokenConfig'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
  verifyContract,
} from '../deployment/deployment_utils'

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

  rTokenDeployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)
  const tradingRange = rTokenConf.params.rTokenTradingRange

  /********************** Verify RTokenAsset ****************************************/
  await verifyContract(
    chainId,
    rTokenDeployments.rTokenAsset,
    [
      rTokenDeployments.components.rToken,
      {
        minVal: tradingRange.minVal,
        maxVal: tradingRange.maxVal,
        minAmt: tradingRange.minAmt,
        maxAmt: tradingRange.maxAmt,
      },
    ],
    'contracts/plugins/assets/RTokenAsset.sol:RTokenAsset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
