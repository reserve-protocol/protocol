import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import {
  developmentChains,
  networkConfig,
  IRTokenConfig,
  IGovParams,
} from '../../common/configuration'
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

  // Mainnet and testnet get pretty different treatments. We don't want to deploy any RTokens on
  // mainnet, so we need to deploy dummy governance + timelock contracts in order to verify.
  if (chainId == 1) {
    await verifyOnMainnet(chainId, rTokenConf)
  } else {
    await verifyOnTestnet(chainId, rTokenConf)
  }
}

async function verifyOnMainnet(chainId: number, rTokenConf: IRTokenConfig & IGovParams) {
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

async function verifyOnTestnet(chainId: number, rTokenConf: IRTokenConfig & IGovParams) {
  /********************** Verify TimelockController ****************************************/
  const TimelockFactory = await hre.ethers.getContractFactory('TimelockController')
  const dummyTimelock = await TimelockFactory.deploy(rTokenConf.timelockDelay.toString(), [], [])

  // Sleep to ensure API is in sync with chain
  await new Promise((r) => setTimeout(r, 20000)) // 20s

  await verifyContract(
    chainId,
    dummyTimelock.address,
    [rTokenConf.timelockDelay, [], []],
    '@openzeppelin/contracts/governance/TimelockController.sol:TimelockController'
  )

  /********************** Verify Governance ****************************************/
  const GovernanceFactory = await hre.ethers.getContractFactory('Governance')
  const dummyGovernance = await GovernanceFactory.deploy(
    rTokenDeployments.components.stRSR,
    rTokenDeployments.timelock,
    '1',
    '1',
    '1',
    '1'
  )

  // Sleep to ensure API is in sync with chain
  await new Promise((r) => setTimeout(r, 20000)) // 20s

  await verifyContract(
    chainId,
    dummyGovernance.address,
    [rTokenDeployments.components.stRSR, rTokenDeployments.timelock, '1', '1', '1', '1'],
    '@openzeppelin/contracts/governance/TimelockController.sol:TimelockController'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
