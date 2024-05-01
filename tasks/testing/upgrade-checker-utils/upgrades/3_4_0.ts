import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ProposalBuilder, buildProposal } from '../governance'
import { Proposal } from '#/utils/subgraph'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '#/scripts/deployment/common'
import { bn } from '#/common/numbers'

const EXECUTOR_ROLE = '0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63'
const PROPOSER_ROLE = '0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1'

// RToken address => Governor Anastasius address
export const GOVERNOR_ANASTASIUSES: { [key: string]: string } = {
  '0xCc7FF230365bD730eE4B352cC2492CEdAC49383e': '0x5ef74a083ac932b5f050bf41cde1f67c659b4b88',
  '0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff': '0x8A11D590B32186E1236B5E75F2d8D72c280dc880',
  '0xfE0D6D83033e313691E96909d2188C150b834285': '0xaeCa35F0cB9d12D68adC4d734D4383593F109654',
  '0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d': '0xC8f487B34251Eb76761168B70Dc10fA38B0Bd90b',
  '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F': '0xfa4Cc3c65c5CCe085Fc78dD262d00500cf7546CD',
  '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8': '0x991c13ff5e8bd3FFc59244A8cF13E0253C78d2bD',
  '0xaCdf0DBA4B9839b96221a8487e9ca660a48212be': '0xb79434b4778E5C1930672053f4bE88D11BbD1f97',
  '0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b': '0x6814F3489cbE3EB32b27508a75821073C85C12b7',
  '0x0d86883FAf4FfD7aEb116390af37746F45b6f378': '0x16a0F420426FD102a85A7CcA4BA25f6be1E98cFc',
  '0x78da5799CF427Fee11e9996982F4150eCe7a99A7': '0xE5D337258a1e8046fa87Ca687e3455Eb8b626e1F',
}

// some RTokens are on 1 week and some 2 week
const ONE_WEEK_REWARD_RATIO = '1146076687500'
const TWO_WEEK_REWARD_RATIO = '573038343750'

export const proposal_3_4_0_step_1: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  timelockAddress?: string
): Promise<Proposal> => {
  const deploymentFilename = getDeploymentFilename(1) // mainnet only
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)
  console.log(deployments.implementations.components)

  // Confirm old governor is Alexios
  const alexios = await hre.ethers.getContractAt('Governance', governorAddress)
  if ((await alexios.name()) != 'Governor Alexios') throw new Error('Governor Alexios only')

  // Confirm a Governor Anastasius exists
  const anastasius = await hre.ethers.getContractAt(
    'Governance',
    GOVERNOR_ANASTASIUSES[rTokenAddress]
  )
  if ((await anastasius.name()) != 'Governor Anastasius') throw new Error('configuration error')

  // Validate timelock is controlled by governance
  if (!timelockAddress) throw new Error('missing timelockAddress')
  const timelock = await hre.ethers.getContractAt('TimelockController', timelockAddress)
  if (!(await timelock.hasRole(EXECUTOR_ROLE, governorAddress)))
    throw new Error('missing EXECUTOR_ROLE')
  if (!(await timelock.hasRole(PROPOSER_ROLE, governorAddress)))
    throw new Error('missing PROPOSER_ROLE')

  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const distributor = await hre.ethers.getContractAt('DistributorP1', await main.distributor())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const rTokenTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rTokenTrader())

  // Build proposal
  const txs = [
    await main.populateTransaction.upgradeTo(deployments.implementations.main),
    await assetRegistry.populateTransaction.upgradeTo(
      deployments.implementations.components.assetRegistry
    ),
    await backingManager.populateTransaction.upgradeTo(
      deployments.implementations.components.backingManager
    ),
    await basketHandler.populateTransaction.upgradeTo(
      deployments.implementations.components.basketHandler
    ),
    await broker.populateTransaction.upgradeTo(deployments.implementations.components.broker),
    await distributor.populateTransaction.upgradeTo(
      deployments.implementations.components.distributor
    ),
    await furnace.populateTransaction.upgradeTo(deployments.implementations.components.furnace),
    await rsrTrader.populateTransaction.upgradeTo(deployments.implementations.components.rsrTrader),
    await rTokenTrader.populateTransaction.upgradeTo(
      deployments.implementations.components.rTokenTrader
    ),
    await stRSR.populateTransaction.upgradeTo(deployments.implementations.components.stRSR),
    await rToken.populateTransaction.upgradeTo(deployments.implementations.components.rToken),
    await broker.populateTransaction.cacheComponents(),
    await backingManager.populateTransaction.cacheComponents(),
    await distributor.populateTransaction.cacheComponents(),
    await rTokenTrader.populateTransaction.cacheComponents(),
    await rsrTrader.populateTransaction.cacheComponents(),
    await furnace.populateTransaction.setRatio(TWO_WEEK_REWARD_RATIO),
    await stRSR.populateTransaction.setRewardRatio(TWO_WEEK_REWARD_RATIO),
    // TODO
    // plugin rotation

    await timelock.populateTransaction.grantRole(EXECUTOR_ROLE, anastasius.address),
    await timelock.populateTransaction.grantRole(PROPOSER_ROLE, anastasius.address),
    await timelock.populateTransaction.revokeRole(EXECUTOR_ROLE, alexios.address),
    await timelock.populateTransaction.grantRole(PROPOSER_ROLE, alexios.address),
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
