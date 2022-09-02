import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { fp } from '../../common/numbers'
import { ZERO_ADDRESS } from '../../common/constants'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment/common'
import { getOracleTimeout, verifyContract } from '../deployment/utils'

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

  /** ******************** Verify RSR Asset ****************************************/
  await verifyContract(
    chainId,
    deployments.rsrAsset,
    [
      deployments.prerequisites.RSR_FEED,
      deployments.prerequisites.RSR,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0'), // $10k
        maxVal: fp(chainId == 1 ? '1e6' : '0'), // $1m,
        minAmt: fp(chainId == 1 ? '1e6' : '1'), // 1M RSR
        maxAmt: fp(chainId == 1 ? '1e8' : '1e9'), // 100M RSR,
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
