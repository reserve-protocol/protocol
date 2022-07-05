import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment_utils'

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
  console.time('Verifying TradingLib')
  await hre.run('verify:verify', {
    address: deployments.tradingLib,
    constructorArguments: [],
    contract: 'contracts/p1/mixins/TradingLib.sol:TradingLibP1',
  })
  console.timeEnd('Verifying TradingLib')

  /** ******************** Verify Rewardable Library ****************************************/
  console.time('Verifying RewardableLib')
  await hre.run('verify:verify', {
    address: deployments.rewardableLib,
    constructorArguments: [],
    contract: 'contracts/p1/mixins/RewardableLib.sol:RewardableLibP1',
  })
  console.timeEnd('Verifying RewardableLib')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
