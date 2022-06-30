import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getRTokenConfig } from './rTokenConfig'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'
import { Governance, MainP1, RTokenP1, StRSRP1, TimelockController } from '../../../typechain'

let timelock: TimelockController
let governance: Governance

// Define the Token to use
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(`Deploying Governance for RToken ${rTokenConf.symbol} to network ${hre.network.name} (${chainId})
   with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check previous step completed
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  const rTokenDeployments = <IRTokenDeployments>getDeploymentFile(rTokenDeploymentFilename)

  // Check Main available
  if (
    !rTokenDeployments.main ||
    !rTokenDeployments.components.rToken ||
    !rTokenDeployments.components.stRSR
  ) {
    throw new Error(`Missing deployments in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rTokenDeployments.main))) {
    throw new Error(`Main contract not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rTokenDeployments.components.rToken))) {
    throw new Error(`RToken contract not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rTokenDeployments.components.stRSR))) {
    throw new Error(`StRSR contract not found in network ${hre.network.name}`)
  }

  // Get StRSRVotes contract and perform validations
  const rToken: RTokenP1 = <RTokenP1>await ethers.getContractAt('RTokenP1', rTokenDeployments.components.rToken)
  const main: MainP1 = <MainP1>await ethers.getContractAt('MainP1', await rToken.main())
  const stRSR: StRSRP1 = <StRSRP1>await ethers.getContractAt('StRSRP1', await main.stRSR())

  if ( main.address != rTokenDeployments.main || stRSR.address != rTokenDeployments.components.stRSR ) {
    throw new Error(`Invalid addresses in config file for RToken ${RTOKEN_NAME} in network ${hre.network.name}`)
  }

  // ******************** Deploy Governance ****************************************/
  // Deploy TimelockController
  const TimelockFactory = await ethers.getContractFactory('TimelockController')
  timelock = <TimelockController>await TimelockFactory.deploy(rTokenConf.minDelay, [], [])
  await timelock.deployed()

  
  const GovernanceFactory = await ethers.getContractFactory('Governance')
  governance = <Governance>(
    await GovernanceFactory.connect(burner).deploy(
      stRSR.address,
      timelock.address,
      rTokenConf.votingDelay,
      rTokenConf.votingPeriod,
      rTokenConf.proposalThresholdAsMicroPercent,
      rTokenConf.quorumPercent
    )
  )
  await governance.deployed()

  // Write temporary deployments file
  rTokenDeployments.governance = governance.address
  rTokenDeployments.timelock = timelock.address
  
  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployed for RToken ${RTOKEN_NAME} in ${hre.network.name} (${chainId})
    Governance:  ${governance.address}
    Timelock: ${timelock.address}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
