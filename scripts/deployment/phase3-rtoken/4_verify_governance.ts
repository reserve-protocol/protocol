import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { getRTokenConfig } from './rTokenConfig'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'

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

  /********************** Verify Governance ****************************************/
  console.time('Verifying Governance')
  await hre.run('verify:verify', {
    address: rTokenDeployments.governance,
    constructorArguments: [
      rTokenDeployments.components.stRSR,
      rTokenDeployments.timelock,
      rTokenConf.votingDelay,
      rTokenConf.votingPeriod,
      rTokenConf.proposalThresholdAsMicroPercent,
      rTokenConf.quorumPercent,
    ],
    contract: 'contracts/plugins/governance/Governance.sol:Governance',
  })
  console.timeEnd('Verifying Governance')

  /********************** Verify TimelockController ****************************************/
  console.time('Verifying TimelockController')
  await hre.run('verify:verify', {
    address: rTokenDeployments.timelock,
    constructorArguments: [rTokenConf.timelockDelay, [], []],
    contract: '@openzeppelin/contracts/governance/TimelockController.sol:TimelockController',
  })
  console.timeEnd('Verifying TimelockController')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
