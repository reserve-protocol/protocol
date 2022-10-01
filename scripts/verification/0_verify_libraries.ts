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

  /** ******************** Verify Trading Library ****************************************/
  await verifyContract(
    chainId,
    deployments.tradingLib,
    [],
    'contracts/p1/mixins/TradingLib.sol:CollateralizationLibP1'
  )

  /** ******************** Verify Rewardable Library ****************************************/
  await verifyContract(
    chainId,
    deployments.rewardableLib,
    [],
    'contracts/p1/mixins/RewardableLib.sol:RewardableLibP1'
  )

  /** ******************** Verify OracleLib Library ****************************************/
  await verifyContract(
    chainId,
    deployments.oracleLib,
    [],
    'contracts/plugins/assets/OracleLib.sol:OracleLib'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
