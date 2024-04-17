import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { expect } from 'chai'
import { ProposalBuilder, buildProposal } from '../governance'
import { Proposal } from '#/utils/subgraph'
import { networkConfig } from '#/common/configuration'
import { bn, fp, toBNDecimals } from '#/common/numbers'
import { CollateralStatus, TradeKind, ZERO_ADDRESS } from '#/common/constants'
import { setOraclePrice } from '../oracles'
import { whileImpersonating } from '#/utils/impersonation'
import { whales } from '../constants'
import { getTokens, runDutchTrade } from '../trades'
import {
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '#/utils/time'

export default async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
) => {
  console.log('\n* * * * * Run checks for release 3.3.0...')
  const [tester] = await hre.ethers.getSigners()
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const timelockAddress = await governor.timelock()
  const timelock = await hre.ethers.getContractAt('TimelockController', timelockAddress)

  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const rsr = await hre.ethers.getContractAt('StRSRP1Votes', await main.rsr())

  console.log('\n3.3.0 check succeeded!')
}

const saUSDTCollateralAddr = '0x8AD3055286f4E59B399616Bd6BEfE24F64573928'
const saUSDCCollateralAddr = '0x6E14943224d6E4F7607943512ba17DbBA9524B8e'
const saEthUSDCCollateralAddr = '0x05beee046A5C28844804E679aD5587046dBffbc0'
const wcUSDCv3CollateralAddr = '0xf0Fb23485057Fd88C80B9CEc8b433FdA47e0a07A'
const cUSDTCollateralAddr = '0x1269BFa56EcaE9D6d5003810D4a35bf8479376b8'
const saEthPyUSDCollateralAddr = '0xe176A5ebFB873D5b3cf1909d0EdaE4FE095F5bc7'
const TUSDCollateralAddr = '0x7F9999B2C9D310a5f48dfD070eb5129e1e8565E2'
const cUSDCVaultCollateralAddr = '0x50a9d529ea175cde72525eaa809f5c3c47daa1bb'
const cUSDTVaultCollateralAddr = '0x5757fF814da66a2B4f9D11d48570d742e246CfD9'

const saEthUSDCERC20Addr = '0x093cB4f405924a0C468b43209d5E466F1dd0aC7d'
const wcUSDCv3ERC20Addr = '0xfBD1a538f5707C0D67a16ca4e3Fc711B80BD931A'
const cUSDTVaultERC20Addr = '0x4Be33630F92661afD646081BC29079A38b879aA0'
const saUSDTERC20Addr = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'
const cUSDTERC20Addr = '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9'
const saEthPyUSDERC20Addr = '0x8d6E0402A3E3aD1b43575b05905F9468447013cF'

const batchTradeImplAddr = '0x803a52c5DAB69B78419bb160051071eF2F9Fd227'
const dutchTradeImplAddr = '0x4eDEb80Ce684A890Dd58Ae0d9762C38731b11b99'

export const proposal_3_3_0_step_1: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())

  // Build proposal
  const txs = [
    await broker.populateTransaction.setDutchTradeImplementation(dutchTradeImplAddr),
    await broker.populateTransaction.setBatchTradeImplementation(batchTradeImplAddr),
    await assetRegistry.populateTransaction.swapRegistered(saUSDTCollateralAddr),
    await assetRegistry.populateTransaction.swapRegistered(saUSDCCollateralAddr),
    await assetRegistry.populateTransaction.register(saEthUSDCCollateralAddr),
    await assetRegistry.populateTransaction.register(wcUSDCv3CollateralAddr),
    await assetRegistry.populateTransaction.register(cUSDTCollateralAddr),
    await assetRegistry.populateTransaction.register(saEthPyUSDCollateralAddr),
    await basketHandler.populateTransaction.setPrimeBasket(
      [saEthUSDCERC20Addr, wcUSDCv3ERC20Addr, cUSDTVaultERC20Addr, saUSDTERC20Addr],
      [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]
    ),
    await basketHandler.populateTransaction.refreshBasket(),
    await rToken.populateTransaction.setRedemptionThrottleParams({
      amtRate: bn('25e23'),
      pctRate: bn('125000000000000000'),
    }),
  ]

  const description = 'Step 1/4 of eUSD 3.3.0 plugin upgrade.'

  return buildProposal(txs, description)
}

export const proposal_3_3_0_step_2: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  // Build proposal
  const txs = [
    await basketHandler.populateTransaction.setPrimeBasket(
      [saEthUSDCERC20Addr, wcUSDCv3ERC20Addr, cUSDTERC20Addr, saUSDTERC20Addr],
      [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]
    ),
    await basketHandler.populateTransaction.refreshBasket(),
  ]

  const description = 'Step 2/4 of eUSD 3.3.0 plugin upgrade.'

  return buildProposal(txs, description)
}

export const proposal_3_3_0_step_3: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  // Build proposal
  const txs = [
    await basketHandler.populateTransaction.setPrimeBasket(
      [saEthUSDCERC20Addr, wcUSDCv3ERC20Addr, cUSDTERC20Addr, saEthPyUSDERC20Addr],
      [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]
    ),
    await basketHandler.populateTransaction.refreshBasket(),
  ]

  const description = 'Step 3/4 of eUSD 3.3.0 plugin upgrade.'

  return buildProposal(txs, description)
}

export const proposal_3_3_0_step_4: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())

  // Build proposal
  const txs = [
    await rToken.populateTransaction.setIssuanceThrottleParams({
      amtRate: bn('2e24'),
      pctRate: bn('100000000000000000'),
    }),
    await basketHandler.populateTransaction.setBackupConfig(
      '0x5553440000000000000000000000000000000000000000000000000000000000',
      bn('2000000000000000000'),
      [
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0xdac17f958d2ee523a2206206994597c13d831ec7',
        '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
        '0x6b175474e89094c44da98b954eedeac495271d0f',
      ]
    ),
    await assetRegistry.populateTransaction.unregister(TUSDCollateralAddr),
    await assetRegistry.populateTransaction.unregister(cUSDCVaultCollateralAddr),
    await assetRegistry.populateTransaction.unregister(cUSDTVaultCollateralAddr),
    await assetRegistry.populateTransaction.unregister(saUSDCCollateralAddr),
    await assetRegistry.populateTransaction.unregister(saUSDTCollateralAddr),
  ]

  const description = 'Step 4/4 of eUSD 3.3.0 plugin upgrade.'

  return buildProposal(txs, description)
}
