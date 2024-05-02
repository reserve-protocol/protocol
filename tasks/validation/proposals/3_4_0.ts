import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ProposalBuilder, buildProposal } from '../utils/governance'
import { Proposal } from '#/utils/subgraph'
import { bn } from '#/common/numbers'

const MAIN_OWNER_ROLE = '0x4f574e4552000000000000000000000000000000000000000000000000000000'
const TIMELOCK_ADMIN_ROLE = '0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5'
const EXECUTOR_ROLE = '0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63'
const PROPOSER_ROLE = '0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1'
const CANCELLER_ROLE = '0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783'

// some RTokens are on 1 week and some 2 week
const ONE_WEEK_REWARD_RATIO = '1146076687500'
// const TWO_WEEK_REWARD_RATIO = '573038343750'

export const proposal_3_4_0_step_1: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  timelockAddress?: string
): Promise<Proposal> => {
  // Confirm old governor is Alexios
  const alexios = await hre.ethers.getContractAt('Governance', governorAddress)
  if ((await alexios.name()) != 'Governor Alexios') throw new Error('Governor Alexios only')

  // Validate timelock is controlled by governance
  if (!timelockAddress) throw new Error('missing timelockAddress')
  const timelock = await hre.ethers.getContractAt('TimelockController', timelockAddress)
  if (!(await timelock.hasRole(EXECUTOR_ROLE, governorAddress)))
    throw new Error('missing EXECUTOR_ROLE')
  if (!(await timelock.hasRole(PROPOSER_ROLE, governorAddress)))
    throw new Error('missing PROPOSER_ROLE')
  // it might be missing CANCELLER_ROLE, that's ok

  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())

  // TODO remove
  // Deploy 3.4.0 Upgrade spell
  console.log('Deploying 3.4.0 Upgrade spell...')
  const SpellFactory = await hre.ethers.getContractFactory('Upgrade3_4_0')
  const spell = await SpellFactory.deploy()
  console.log('Deployed!')

  // Build proposal
  const txs = [
    await main.populateTransaction.grantRole(MAIN_OWNER_ROLE, spell.address),
    await timelock.populateTransaction.grantRole(TIMELOCK_ADMIN_ROLE, spell.address),
    await spell.populateTransaction.cast(rTokenAddress, governorAddress),
  ]

  const description = '3.4.0 Upgrade (1/2) - Core Contracts + Plugins'

  return buildProposal(txs, description)
}

export const proposal_3_4_0_step_2: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  timelockAddress?: string
): Promise<Proposal> => {
  // Assumption: The upgrade spell has been cast

  // Confirm governor is now Anastasius
  const anastasius = await hre.ethers.getContractAt('Governance', governorAddress)
  if ((await anastasius.name()) != 'Governor Anastasius') throw new Error('step one incomplete')

  // Validate timelock is controlled by governance
  if (!timelockAddress) throw new Error('missing timelockAddress')
  const timelock = await hre.ethers.getContractAt('TimelockController', timelockAddress)
  if (!(await timelock.hasRole(EXECUTOR_ROLE, governorAddress)))
    throw new Error('missing EXECUTOR_ROLE')
  if (!(await timelock.hasRole(PROPOSER_ROLE, governorAddress)))
    throw new Error('missing PROPOSER_ROLE')
  if (!(await timelock.hasRole(CANCELLER_ROLE, governorAddress)))
    throw new Error('missing CANCELLER_ROLE')

  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())

  // Build proposal
  const txs = [
    await backingManager.populateTransaction.setTradingDelay(0),
    await furnace.populateTransaction.setRatio(ONE_WEEK_REWARD_RATIO),
    await stRSR.populateTransaction.setRewardRatio(ONE_WEEK_REWARD_RATIO),
    await rToken.populateTransaction.setIssuanceThrottleParams({
      amtRate: bn('2e24'),
      pctRate: bn('1e17'),
    }),
  ]

  const description = '3.4.0 Upgrade (2/2) - Parameters'

  return buildProposal(txs, description)
}
