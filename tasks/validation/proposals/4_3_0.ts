import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { buildProposal } from '../utils/governance'
import { Proposal } from '#/utils/subgraph'
import { MAIN_OWNER_ROLE, EXECUTOR_ROLE, PROPOSER_ROLE } from './4_2_0'

export const proposal_4_3_0 = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  timelockAddress: string,
  spellAddress: string
): Promise<Proposal> => {
  // Confirm governor is Anastasius
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

  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  if (!(await main.hasRole(MAIN_OWNER_ROLE, timelockAddress))) {
    throw new Error('timelock does not own Main')
  }
  const spell = await hre.ethers.getContractAt('Upgrade4_3_0', spellAddress)

  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const assetPluginRegistry = await hre.ethers.getContractAt(
    'AssetPluginRegistry',
    await main.assetPluginRegistry()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const [primeERC20s] = await basketHandler.getPrimeBasket()

  // Unregister deprecated assets, which would fail the spell's asset validation
  const txs = []
  const [erc20s, assets] = await assetRegistry.getRegistry()
  for (let i = 0; i < assets.length; i++) {
    if (!(await assetPluginRegistry.isDeprecated(assets[i]))) continue

    if (primeERC20s.includes(erc20s[i]) || (await basketHandler.quantity(erc20s[i])).gt(0)) {
      throw new Error(`deprecated asset ${assets[i]} is in the basket`)
    }

    console.log(`Unregistering deprecated asset ${assets[i]}`)
    txs.push(await assetRegistry.populateTransaction.unregister(assets[i]))
  }

  // Build proposal
  txs.push(
    await main.populateTransaction.grantRole(MAIN_OWNER_ROLE, spell.address),
    await spell.populateTransaction.castSpell(rTokenAddress)
  )

  const description = '4.3.0 Upgrade - Core Contracts'

  return buildProposal(txs, description)
}
