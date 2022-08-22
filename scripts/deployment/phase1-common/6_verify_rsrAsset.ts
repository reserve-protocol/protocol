import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  getOracleTimeout,
} from '../deployment_utils'
import { getRSRTradingRange } from './5_deploy_rsrAsset'

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
  console.time('Verifying RSR Asset')
  await hre.run('verify:verify', {
    address: deployments.rsrAsset,
    constructorArguments: [
      deployments.prerequisites.RSR_FEED,
      deployments.prerequisites.RSR,
      ZERO_ADDRESS,
      tradingRange.minVal.toString(),
      tradingRange.maxVal.toString(),
      tradingRange.minAmt.toString(),
      tradingRange.maxAmt.toString(),
      getOracleTimeout(chainId).toString(),
      deployments.oracleLib,
    ],
    contract: 'contracts/plugins/assets/Asset.sol:Asset',
  })
  console.timeEnd('Verifying RSR Asset')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
