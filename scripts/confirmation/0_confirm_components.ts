import hre from 'hardhat'

import { bn } from '../../common/numbers'
import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment/common'
import { RTOKEN_NAME } from '../deployment/phase3-rtoken/rTokenConfig'

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  const isMainnet = chainId == '1'
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  // Get RToken Configuration
  // Check previous step completed
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  const rTokenDeployments = <IRTokenDeployments>getDeploymentFile(rTokenDeploymentFilename)

  const mainComponent = await hre.ethers.getContractAt('MainP1', rTokenDeployments.main)

  if (isMainnet) {
    // Confirm Main is paused
    console.log('Checking main is configured correctly')
    if (!(await mainComponent.tradingPaused())) throw new Error('main is unpaused for trading')
    if (!(await mainComponent.issuancePaused())) throw new Error('main is unpaused for issuance')

    // Confirm governance is configured correctly
    const timelock = await hre.ethers.getContractAt(
      'TimelockController',
      rTokenDeployments.timelock
    )
    console.log('Checking timelock is configured correctly')
    if ((await timelock.getMinDelay()).lt(bn('1e12'))) {
      throw new Error('timelock duration too short')
    }
  }

  // TODO ...more?
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
