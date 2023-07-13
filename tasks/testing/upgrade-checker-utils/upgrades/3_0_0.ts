import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ProposalBuilder, buildProposal } from '../governance'
import { Proposal } from '#/utils/subgraph'
import { IImplementations, networkConfig } from '#/common/configuration'
import { bn, fp } from '#/common/numbers'
import {
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BasketLibP1,
  BrokerP1,
  CTokenFiatCollateral,
  DistributorP1,
  FurnaceP1,
  GnosisTrade,
  IERC20Metadata,
  DutchTrade,
  RevenueTraderP1,
  RTokenP1,
  StRSRP1Votes,
  MainP1,
  RecollateralizationLibP1,
} from '../../../../typechain'

export default async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
) => {
  console.log('\n* * * * * Run checks for release 3.0.0...')
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

  // TODO: 3.0.0 Specific checks
  console.log('\n3.0.0 check succeeded!')
}

export const proposal_3_0_0: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
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
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const rTokenTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rTokenTrader())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())

  // TODO: Uncomment and replace with deployed addresses once they are available
  /* 
  const mainImplAddr = '0x...'
  const batchTradeImplAddr = '0x...'
  const dutchTradeImplAddr = '0x...'
  const assetRegImplAddr = '0x...'
  const bckMgrImplAddr = '0x...'
  const bsktHdlImplAddr = '0x...'
  const brokerImplAddr = '0x...'
  const distImplAddr = '0x...'
  const furnaceImplAddr = '0x...'
  const rsrTraderImplAddr = '0x...'
  const rTokenTraderImplAddr = '0x...'
  const rTokenImplAddr = '0x...'
  const stRSRImplAddr = '0x...'  
 */

  // TODO: Remove code once addresses are available
  const implementations: IImplementations = await deployNewImplementations(hre)
  const mainImplAddr = implementations.main
  const batchTradeImplAddr = implementations.trading.gnosisTrade
  const dutchTradeImplAddr = implementations.trading.dutchTrade
  const assetRegImplAddr = implementations.components.assetRegistry
  const bckMgrImplAddr = implementations.components.backingManager
  const bsktHdlImplAddr = implementations.components.basketHandler
  const brokerImplAddr = implementations.components.broker
  const distImplAddr = implementations.components.distributor
  const furnaceImplAddr = implementations.components.furnace
  const rsrTraderImplAddr = implementations.components.rsrTrader
  const rTokenTraderImplAddr = implementations.components.rTokenTrader
  const rTokenImplAddr = implementations.components.rToken
  const stRSRImplAddr = implementations.components.stRSR

  // TODO: Uncomment and replace with deployed addresses once they are available
  /*
  const cUSDCVaultAddr = '0x...'
  const cUSDCNewCollateralAddr = '0x...'
  const cUSDTVaultAddr = '0x...'
  const cUSDTNewCollateralAddr = '0x...'
   */
  const saUSDCCollateralAddr = '0x60C384e226b120d93f3e0F4C502957b2B9C32B15'
  const saUSDTCollateralAddr = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'

  // TODO: Remove code once addresses are available
  // CUSDC Vault and collateral
  const [cUSDCVaultAddr, cUSDCVaultCollateralAddr] = await makeCTokenVaultCollateral(
    hre,
    networkConfig['1'].tokens.cUSDC!,
    await assetRegistry.toColl(networkConfig['1'].tokens.cUSDC!),
    networkConfig['1'].COMPTROLLER!
  )
  const [cUSDTVaultAddr, cUSDTVaultCollateralAddr] = await makeCTokenVaultCollateral(
    hre,
    networkConfig['1'].tokens.cUSDT!,
    await assetRegistry.toColl(networkConfig['1'].tokens.cUSDT!),
    networkConfig['1'].COMPTROLLER!
  )

  // Step 1 - Update implementations and config
  const txs = [
    await main.populateTransaction.upgradeTo(mainImplAddr),
    await assetRegistry.populateTransaction.upgradeTo(assetRegImplAddr),
    await backingManager.populateTransaction.upgradeTo(bckMgrImplAddr),
    await basketHandler.populateTransaction.upgradeTo(bsktHdlImplAddr),
    await broker.populateTransaction.upgradeTo(brokerImplAddr),
    await distributor.populateTransaction.upgradeTo(distImplAddr),
    await furnace.populateTransaction.upgradeTo(furnaceImplAddr),
    await rsrTrader.populateTransaction.upgradeTo(rsrTraderImplAddr),
    await rTokenTrader.populateTransaction.upgradeTo(rTokenTraderImplAddr),
    await rToken.populateTransaction.upgradeTo(rTokenImplAddr),
    await stRSR.populateTransaction.upgradeTo(stRSRImplAddr),
    await broker.populateTransaction.setBatchTradeImplementation(batchTradeImplAddr),
    await broker.populateTransaction.setDutchTradeImplementation(dutchTradeImplAddr),
    await backingManager.populateTransaction.cacheComponents(),
    await rsrTrader.populateTransaction.cacheComponents(),
    await rTokenTrader.populateTransaction.cacheComponents(),
    await distributor.populateTransaction.cacheComponents(),
    await basketHandler.populateTransaction.setWarmupPeriod(900),
    await stRSR.populateTransaction.setWithdrawalLeak(bn('5e16')),
    await broker.populateTransaction.setDutchAuctionLength(1800),
  ]

  // Step 2 - Basket change
  txs.push(
    await assetRegistry.populateTransaction.register(cUSDCVaultCollateralAddr),
    await assetRegistry.populateTransaction.register(cUSDTVaultCollateralAddr),
    await basketHandler.populateTransaction.setPrimeBasket(
      [saUSDCCollateralAddr, cUSDCVaultAddr, saUSDTCollateralAddr, cUSDTVaultAddr],
      [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]
    ),
    await basketHandler.populateTransaction.refreshBasket()
  )

  const description =
    'Upgrade implementations, set trade plugins, components, config values, and update basket'

  return buildProposal(txs, description)
}

// TODO: Remove once final addresses exist on Mainnet
const deployNewImplementations = async (
  hre: HardhatRuntimeEnvironment
): Promise<IImplementations> => {
  // Deploy new implementations
  const MainImplFactory = await hre.ethers.getContractFactory('MainP1')
  const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

  // Deploy TradingLib external library
  const TradingLibFactory = await hre.ethers.getContractFactory('RecollateralizationLibP1')
  const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
    await TradingLibFactory.deploy()
  )

  // Deploy BasketLib external library
  const BasketLibFactory = await hre.ethers.getContractFactory('BasketLibP1')
  const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()

  const AssetRegImplFactory = await hre.ethers.getContractFactory('AssetRegistryP1')
  const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

  const BackingMgrImplFactory = await hre.ethers.getContractFactory('BackingManagerP1', {
    libraries: {
      RecollateralizationLibP1: tradingLib.address,
    },
  })
  const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

  const BskHandlerImplFactory = await hre.ethers.getContractFactory('BasketHandlerP1', {
    libraries: { BasketLibP1: basketLib.address },
  })
  const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

  const DistribImplFactory = await hre.ethers.getContractFactory('DistributorP1')
  const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

  const RevTraderImplFactory = await hre.ethers.getContractFactory('RevenueTraderP1')
  const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

  const FurnaceImplFactory = await hre.ethers.getContractFactory('FurnaceP1')
  const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

  const GnosisTradeImplFactory = await hre.ethers.getContractFactory('GnosisTrade')
  const gnosisTrade: GnosisTrade = <GnosisTrade>await GnosisTradeImplFactory.deploy()

  const DutchTradeImplFactory = await hre.ethers.getContractFactory('DutchTrade')
  const dutchTrade: DutchTrade = <DutchTrade>await DutchTradeImplFactory.deploy()

  const BrokerImplFactory = await hre.ethers.getContractFactory('BrokerP1')
  const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

  const RTokenImplFactory = await hre.ethers.getContractFactory('RTokenP1')
  const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

  const StRSRImplFactory = await hre.ethers.getContractFactory('StRSRP1Votes')
  const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

  return {
    main: mainImpl.address,
    trading: { gnosisTrade: gnosisTrade.address, dutchTrade: dutchTrade.address },
    components: {
      assetRegistry: assetRegImpl.address,
      backingManager: backingMgrImpl.address,
      basketHandler: bskHndlrImpl.address,
      broker: brokerImpl.address,
      distributor: distribImpl.address,
      furnace: furnaceImpl.address,
      rsrTrader: revTraderImpl.address,
      rTokenTrader: revTraderImpl.address,
      rToken: rTokenImpl.address,
      stRSR: stRSRImpl.address,
    },
  }
}

// TODO: Remove once final addresses exist on Mainnet
const makeCTokenVaultCollateral = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  collAddress: string,
  comptrollerAddr: string
): Promise<[string, string]> => {
  const CTokenWrapperFactory = await hre.ethers.getContractFactory('CTokenWrapper')
  const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral')

  const erc20: IERC20Metadata = <IERC20Metadata>(
    await hre.ethers.getContractAt('CTokenMock', tokenAddress)
  )

  const currentColl: CTokenFiatCollateral = <CTokenFiatCollateral>(
    await hre.ethers.getContractAt('CTokenFiatCollateral', collAddress)
  )

  const vault = await CTokenWrapperFactory.deploy(
    erc20.address,
    `${await erc20.name()} Vault`,
    `${await erc20.symbol()}-VAULT`,
    comptrollerAddr
  )

  await vault.deployed()

  const coll = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
    {
      priceTimeout: await currentColl.priceTimeout(),
      chainlinkFeed: await currentColl.chainlinkFeed(),
      oracleError: await currentColl.oracleError(),
      erc20: vault.address,
      maxTradeVolume: await currentColl.maxTradeVolume(),
      oracleTimeout: await currentColl.oracleTimeout(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(),
      delayUntilDefault: await currentColl.delayUntilDefault(),
    },
    fp('1e-6')
  )

  await coll.deployed()

  await (await coll.refresh()).wait()

  return [vault.address, coll.address]
}
