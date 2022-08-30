import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getRTokenConfig } from '../deployment/phase3-rtoken/rTokenConfig'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
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

  rTokenDeployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  /********************** Verify TimelockController ****************************************/
  await verifyContract(
    chainId,
    rTokenDeployments.timelock,
    [rTokenConf.timelockDelay, [], []],
    '@openzeppelin/contracts/governance/TimelockController.sol:TimelockController'
  )

  /********************** Verify Governance ****************************************/
  await verifyContract(
    chainId,
    rTokenDeployments.governance,
    [
      rTokenDeployments.components.stRSR,
      rTokenDeployments.timelock,
      rTokenConf.votingDelay,
      rTokenConf.votingPeriod,
      rTokenConf.proposalThresholdAsMicroPercent,
      rTokenConf.quorumPercent,
    ],
    'contracts/plugins/governance/Governance.sol:Governance'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
