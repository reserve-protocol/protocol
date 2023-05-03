import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { IGovParams, IGovRoles, networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { expectInReceipt } from '../../../common/events'
import { getRTokenConfig, RTOKEN_NAME } from './rTokenConfig'
import { getDeploymentFile, getRTokenDeploymentFilename, IRTokenDeployments } from '../common'
import { FacadeWrite, MainP1, RTokenP1, StRSRP1 } from '../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [deployerUser] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(`Deploying Governance for RToken ${rTokenConf.symbol} to network ${hre.network.name} (${chainId})
   with deployer account: ${deployerUser.address}`)

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

  // ******************** Setup Bricked Governance ****************************************/
  const facadeWrite = <FacadeWrite>(
    await ethers.getContractAt('FacadeWrite', rTokenDeployments.facadeWrite)
  )

  const govParams: IGovParams = {
    votingDelay: rTokenConf.votingDelay,
    votingPeriod: rTokenConf.votingPeriod,
    proposalThresholdAsMicroPercent: rTokenConf.proposalThresholdAsMicroPercent,
    quorumPercent: rTokenConf.quorumPercent,
    timelockDelay: rTokenConf.timelockDelay,
  }

  // Setup Governance in RToken
  const govRoles: IGovRoles = {
    owner: ZERO_ADDRESS,
    guardian: ZERO_ADDRESS,
    pausers: [],
    shortFreezers: [],
    longFreezers: [],
  }

  const receipt = await (
    await facadeWrite.connect(deployerUser).setupGovernance(
      rToken.address,
      true, // deploy governance
      chainId != '1', // unpause if not mainnet
      govParams,
      govRoles
    )
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
