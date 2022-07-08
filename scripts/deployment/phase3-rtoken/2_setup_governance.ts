import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { IGovParams, networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { expectInReceipt } from '../../../common/events'
import { getRTokenConfig } from './rTokenConfig'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'
import { FacadeWrite, MainP1, RTokenP1, StRSRP1 } from '../../../typechain'
// Define the Token to use
const RTOKEN_NAME = 'RTKN'

// Address to be used as external owner or pauser (if desired)
const OWNER_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

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
  const rToken: RTokenP1 = <RTokenP1>(
    await ethers.getContractAt('RTokenP1', rTokenDeployments.components.rToken)
  )
  const main: MainP1 = <MainP1>await ethers.getContractAt('MainP1', await rToken.main())
  const stRSR: StRSRP1 = <StRSRP1>await ethers.getContractAt('StRSRP1', await main.stRSR())

  if (
    main.address != rTokenDeployments.main ||
    stRSR.address != rTokenDeployments.components.stRSR
  ) {
    throw new Error(
      `Invalid addresses in config file for RToken ${RTOKEN_NAME} in network ${hre.network.name}`
    )
  }

  // ******************** Setup Governance ****************************************/
  const facadeWrite = <FacadeWrite>(
    await ethers.getContractAt('FacadeWrite', rTokenDeployments.facadeWrite)
  )

  const govParams: IGovParams = {
    votingDelay: rTokenConf.votingDelay,
    votingPeriod: rTokenConf.votingPeriod,
    proposalThresholdAsMicroPercent: rTokenConf.proposalThresholdAsMicroPercent,
    quorumPercent: rTokenConf.quorumPercent,
    minDelay: rTokenConf.minDelay,
  }

  // Setup Governance in RToken
  const receipt = await (
    await facadeWrite
      .connect(burner)
      .setupGovernance(rToken.address, true, false, govParams, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)
  ).wait()

  const governanceAddr = expectInReceipt(receipt, 'GovernanceCreated').args.governance
  const timelockAddr = expectInReceipt(receipt, 'GovernanceCreated').args.timelock

  // Write temporary deployments file
  rTokenDeployments.governance = governanceAddr
  rTokenDeployments.timelock = timelockAddr

  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployed for RToken ${RTOKEN_NAME} in ${hre.network.name} (${chainId})
    Governance:  ${governanceAddr}
    Timelock:  ${timelockAddr}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})