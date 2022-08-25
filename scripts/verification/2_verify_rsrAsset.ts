import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { ZERO_ADDRESS } from '../../common/constants'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  getOracleTimeout,
  verifyContract,
} from '../deployment/deployment_utils'
import { getRSRTradingRange } from '../deployment/phase1-common/3_deploy_rsrAsset'

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

  const tradingRange = getRSRTradingRange(chainId)

  /** ******************** Verify RSR Asset ****************************************/
  await verifyContract(
    chainId,
    deployments.rsrAsset,
    [
      deployments.prerequisites.RSR_FEED,
      deployments.prerequisites.RSR,
      ZERO_ADDRESS,
      {
        minVal: tradingRange.minVal.toString(),
        maxVal: tradingRange.maxVal.toString(),
        minAmt: tradingRange.minAmt.toString(),
        maxAmt: tradingRange.maxAmt.toString(),
      },
      getOracleTimeout(chainId).toString(),
    ],
    'contracts/plugins/assets/Asset.sol:Asset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
