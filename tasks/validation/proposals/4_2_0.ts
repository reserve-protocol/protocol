import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { buildProposal } from '../utils/governance'
import { Proposal } from '#/utils/subgraph'

export const MAIN_OWNER_ROLE = '0x4f574e4552000000000000000000000000000000000000000000000000000000'
export const TIMELOCK_ADMIN_ROLE =
  '0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5'
export const EXECUTOR_ROLE = '0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63'
export const PROPOSER_ROLE = '0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1'
export const CANCELLER_ROLE = '0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783'

export const proposal_4_2_0 = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  timelockAddress: string,
  spellAddress: string
): Promise<Proposal> => {
  // Confirm old governor is Anastasius
  const anastasius = await hre.ethers.getContractAt('Governance', governorAddress)
  const name = await anastasius.name()
  console.log('name', name)

  if (name !== 'Governor Anastasius') {
    throw new Error('Governor Anastasius only')
  }

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
  const spell = await hre.ethers.getContractAt('Upgrade4_2_0', spellAddress)

  // Build proposal
  const txs = [
    await main.populateTransaction.grantRole(MAIN_OWNER_ROLE, spell.address),
    await spell.populateTransaction.castSpell(rTokenAddress, anastasius.address, []),
  ]

  const description = '4.2.0 Upgrade - Core Contracts + Plugins'

  return buildProposal(txs, description)
}
