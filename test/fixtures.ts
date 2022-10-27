import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { IConfig, IImplementations, IRevenueShare, networkConfig } from '../common/configuration'
import { expectInReceipt } from '../common/events'
import { bn, fp } from '../common/numbers'
import { ZERO_ADDRESS, CollateralStatus } from '../common/constants'
import {
  Asset,
  AssetRegistryP1,
  ATokenFiatCollateral,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  DeployerP0,
  DeployerP1,
  FacadeRead,
  FacadeAct,
  FacadeTest,
  DistributorP1,
  FurnaceP1,
  EasyAuction,
  GnosisMock,
  GnosisTrade,
  IAssetRegistry,
  IBasketHandler,
  FiatCollateral,
  MainP1,
  MockV3Aggregator,
  OracleLib,
  PermitLib,
  RevenueTraderP1,
  RewardableLibP1,
  RTokenAsset,
  RTokenP1,
  StaticATokenMock,
  StRSRP1Votes,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  TradingLibP0,
  RecollateralizationLibP1,
  USDCMock,
  NonFiatCollateral,
  SelfReferentialCollateral,
} from '../typechain'

export enum Implementation {
  P0,
  P1,
}

export const IMPLEMENTATION: Implementation =
  process.env.PROTO_IMPL == Implementation.P1.toString() ? Implementation.P1 : Implementation.P0

export const SLOW = !!process.env.SLOW

export const ORACLE_TIMEOUT = bn('281474976710655').div(2) // type(uint48).max / 2

export type Collateral =
  | FiatCollateral
  | CTokenFiatCollateral
  | ATokenFiatCollateral
  | NonFiatCollateral
  | SelfReferentialCollateral

interface RSRFixture {
  rsr: ERC20Mock
}

async function rsrFixture(): Promise<RSRFixture> {
  // Deploy RSR and asset
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const rsr: ERC20Mock = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')

  return { rsr }
}

interface COMPAAVEFixture {
  weth: ERC20Mock
  compToken: ERC20Mock
  compoundMock: ComptrollerMock
  aaveToken: ERC20Mock
}

async function compAaveFixture(): Promise<COMPAAVEFixture> {
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')

  // Deploy WETH
  const weth: ERC20Mock = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')

  // Deploy COMP token and Asset
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')

  // Deploy AAVE token
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')

  // Deploy Comp and Aave Oracle Mocks
  const ComptrollerMockFactory: ContractFactory = await ethers.getContractFactory('ComptrollerMock')
  const compoundMock: ComptrollerMock = <ComptrollerMock>await ComptrollerMockFactory.deploy()
  await compoundMock.setCompToken(compToken.address)

  return {
    weth,
    compToken,
    compoundMock,
    aaveToken,
  }
}

interface GnosisFixture {
  gnosis: GnosisMock
  easyAuction: EasyAuction
}

async function gnosisFixture(): Promise<GnosisFixture> {
  const GnosisFactory: ContractFactory = await ethers.getContractFactory('GnosisMock')
  const chainId = await getChainId(hre)

  return {
    gnosis: <GnosisMock>await GnosisFactory.deploy(),
    easyAuction: <EasyAuction>(
      await ethers.getContractAt('EasyAuction', networkConfig[chainId].GNOSIS_EASY_AUCTION || '')
    ),
  }
}

interface CollateralFixture {
  erc20s: ERC20Mock[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketsNeededAmts: BigNumber[] // reference amounts
}

async function collateralFixture(
  oracleLib: OracleLib,
  comptroller: ComptrollerMock,
  aaveToken: ERC20Mock,
  compToken: ERC20Mock,
  config: IConfig
): Promise<CollateralFixture> {
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const USDC: ContractFactory = await ethers.getContractFactory('USDCMock')
  const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
  const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
  const FiatCollateralFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
    'MockV3Aggregator'
  )

  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (symbol: string): Promise<[ERC20Mock, Collateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ERC20.deploy(symbol + ' Token', symbol)
    const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    )
    const coll = <FiatCollateral>(
      await FiatCollateralFactory.deploy(
        fp('1'),
        chainlinkFeed.address,
        erc20.address,
        ZERO_ADDRESS,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )
    )
    return [erc20, coll]
  }
  const makeSixDecimalCollateral = async (symbol: string): Promise<[USDCMock, Collateral]> => {
    const erc20: USDCMock = <USDCMock>await USDC.deploy(symbol + ' Token', symbol)
    const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    )

    const coll = <FiatCollateral>(
      await FiatCollateralFactory.deploy(
        fp('1'),
        chainlinkFeed.address,
        erc20.address,
        ZERO_ADDRESS,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )
    )
    return [erc20, coll]
  }
  const makeCTokenCollateral = async (
    symbol: string,
    referenceERC20: ERC20Mock,
    chainlinkAddr: string,
    compToken: ERC20Mock
  ): Promise<[CTokenMock, CTokenFiatCollateral]> => {
    const erc20: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(symbol + ' Token', symbol, referenceERC20.address)
    )
    const coll = <CTokenFiatCollateral>(
      await CTokenCollateralFactory.deploy(
        fp('1').div(50),
        chainlinkAddr,
        erc20.address,
        compToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        (await referenceERC20.decimals()).toString(),
        comptroller.address
      )
    )
    return [erc20, coll]
  }
  const makeATokenCollateral = async (
    symbol: string,
    referenceERC20: ERC20Mock,
    chainlinkAddr: string,
    aaveToken: ERC20Mock
  ): Promise<[StaticATokenMock, ATokenFiatCollateral]> => {
    const erc20: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy(symbol + ' Token', symbol, referenceERC20.address)
    )
    await erc20.setAaveToken(aaveToken.address)

    const coll = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.deploy(
        fp('1'),
        chainlinkAddr,
        erc20.address,
        aaveToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )
    )
    return [erc20, coll]
  }

  // Create all possible collateral
  const dai = await makeVanillaCollateral('DAI')
  const usdc = await makeSixDecimalCollateral('USDC')
  const usdt = await makeVanillaCollateral('USDT')
  const busd = await makeVanillaCollateral('BUSD')
  const cdai = await makeCTokenCollateral('cDAI', dai[0], await dai[1].chainlinkFeed(), compToken)
  const cusdc = await makeCTokenCollateral(
    'cUSDC',
    usdc[0],
    await usdc[1].chainlinkFeed(),
    compToken
  )
  const cusdt = await makeCTokenCollateral(
    'cUSDT',
    usdt[0],
    await usdt[1].chainlinkFeed(),
    compToken
  )
  const adai = await makeATokenCollateral('aDAI', dai[0], await dai[1].chainlinkFeed(), aaveToken)
  const ausdc = await makeATokenCollateral(
    'aUSDC',
    usdc[0],
    await usdc[1].chainlinkFeed(),
    aaveToken
  )
  const ausdt = await makeATokenCollateral(
    'aUSDT',
    usdt[0],
    await usdt[1].chainlinkFeed(),
    aaveToken
  )
  const abusd = await makeATokenCollateral(
    'aBUSD',
    busd[0],
    await busd[1].chainlinkFeed(),
    aaveToken
  )
  const erc20s = [
    dai[0],
    usdc[0],
    usdt[0],
    busd[0],
    cdai[0],
    cusdc[0],
    cusdt[0],
    adai[0],
    ausdc[0],
    ausdt[0],
    abusd[0],
  ]
  const collateral = [
    dai[1],
    usdc[1],
    usdt[1],
    busd[1],
    cdai[1],
    cusdc[1],
    cusdt[1],
    adai[1],
    ausdc[1],
    ausdt[1],
    abusd[1],
  ]

  // Create the initial basket
  const basket = [dai[1], usdc[1], adai[1], cdai[1]]
  const basketsNeededAmts = [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]

  return {
    erc20s,
    collateral,
    basket,
    basketsNeededAmts,
  }
}

type RSRAndCompAaveAndCollateralAndModuleFixture = RSRFixture &
  COMPAAVEFixture &
  CollateralFixture &
  GnosisFixture

export interface DefaultFixture extends RSRAndCompAaveAndCollateralAndModuleFixture {
  config: IConfig
  dist: IRevenueShare
  deployer: TestIDeployer
  main: TestIMain
  assetRegistry: IAssetRegistry
  backingManager: TestIBackingManager
  basketHandler: IBasketHandler
  distributor: TestIDistributor
  rsrAsset: Asset
  compAsset: Asset
  aaveAsset: Asset
  rToken: TestIRToken
  rTokenAsset: RTokenAsset
  furnace: TestIFurnace
  stRSR: TestIStRSR
  facade: FacadeRead
  facadeAct: FacadeAct
  facadeTest: FacadeTest
  broker: TestIBroker
  rsrTrader: TestIRevenueTrader
  rTokenTrader: TestIRevenueTrader
  oracleLib: OracleLib
  permitLib: PermitLib
}

export const defaultFixture: Fixture<DefaultFixture> = async function ([
  owner,
]): Promise<DefaultFixture> {
  const { rsr } = await rsrFixture()
  const { weth, compToken, compoundMock, aaveToken } = await compAaveFixture()
  const { gnosis, easyAuction } = await gnosisFixture()
  const gnosisAddr = process.env.FORK ? easyAuction.address : gnosis.address
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }

  // Setup Config
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e-2'), // $0.01
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5% per hour
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP0')
  const tradingLib: TradingLibP0 = <TradingLibP0>await TradingLibFactory.deploy()

  // Deploy TradingLib external library
  const PermitLibFactory: ContractFactory = await ethers.getContractFactory('PermitLib')
  const permitLib: PermitLib = <PermitLib>await PermitLibFactory.deploy()

  // Deploy OracleLib external library
  const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
  const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()

  // Deploy FacadeRead
  const FacadeReadFactory: ContractFactory = await ethers.getContractFactory('FacadeRead')
  const facade = <FacadeRead>await FacadeReadFactory.deploy()

  // Deploy FacadeAct
  const FacadeActFactory: ContractFactory = await ethers.getContractFactory('FacadeAct')
  const facadeAct = <FacadeAct>await FacadeActFactory.deploy()

  // Deploy FacadeTest
  const FacadeTestFactory: ContractFactory = await ethers.getContractFactory('FacadeTest')
  const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()

  // Deploy RSR chainlink feed
  const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
    'MockV3Aggregator'
  )
  const rsrChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  )

  // Deploy RSR Asset
  const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
  const rsrAsset: Asset = <Asset>(
    await AssetFactory.deploy(
      fp('1'),
      rsrChainlinkFeed.address,
      rsr.address,
      ZERO_ADDRESS,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
    libraries: { TradingLibP0: tradingLib.address, PermitLib: permitLib.address },
  })
  let deployer: TestIDeployer = <DeployerP0>(
    await DeployerFactory.deploy(rsr.address, gnosisAddr, rsrAsset.address)
  )

  if (IMPLEMENTATION == Implementation.P1) {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    // Deploy TradingLib external library
    const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
      'RecollateralizationLibP1'
    )
    const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
      await TradingLibFactory.deploy()
    )

    // Deploy RewardableLib external library
    const RewardableLibFactory: ContractFactory = await ethers.getContractFactory('RewardableLibP1')
    const rewardableLib: RewardableLibP1 = <RewardableLibP1>await RewardableLibFactory.deploy()

    const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory('AssetRegistryP1')
    const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

    const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
      'BackingManagerP1',
      {
        libraries: {
          RewardableLibP1: rewardableLib.address,
          RecollateralizationLibP1: tradingLib.address,
        },
      }
    )
    const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

    const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory(
      'BasketHandlerP1'
    )
    const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

    const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
    const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

    const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory(
      'RevenueTraderP1',
      { libraries: { RewardableLibP1: rewardableLib.address } }
    )
    const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

    const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
    const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

    const TradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
    const tradeImpl: GnosisTrade = <GnosisTrade>await TradeImplFactory.deploy()

    const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
    const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

    const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1', {
      libraries: { RewardableLibP1: rewardableLib.address, PermitLib: permitLib.address },
    })
    const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

    const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes', {
      libraries: { PermitLib: permitLib.address },
    })
    const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

    // Setup Implementation addresses
    const implementations: IImplementations = {
      main: mainImpl.address,
      components: {
        rToken: rTokenImpl.address,
        stRSR: stRSRImpl.address,
        assetRegistry: assetRegImpl.address,
        basketHandler: bskHndlrImpl.address,
        backingManager: backingMgrImpl.address,
        distributor: distribImpl.address,
        furnace: furnaceImpl.address,
        broker: brokerImpl.address,
        rsrTrader: revTraderImpl.address,
        rTokenTrader: revTraderImpl.address,
      },
      trade: tradeImpl.address,
    }

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(rsr.address, gnosisAddr, rsrAsset.address, implementations)
    )
  }

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy('RTKN RToken', 'RTKN', 'mandate', owner.address, config)
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
  const main: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

  // Get Core
  const assetRegistry: IAssetRegistry = <IAssetRegistry>(
    await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
  )
  const backingManager: TestIBackingManager = <TestIBackingManager>(
    await ethers.getContractAt('TestIBackingManager', await main.backingManager())
  )
  const basketHandler: IBasketHandler = <IBasketHandler>(
    await ethers.getContractAt('IBasketHandler', await main.basketHandler())
  )
  const distributor: TestIDistributor = <TestIDistributor>(
    await ethers.getContractAt('TestIDistributor', await main.distributor())
  )

  const aaveChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  )
  const aaveAsset: Asset = <Asset>(
    await AssetFactory.deploy(
      fp('1'),
      aaveChainlinkFeed.address,
      aaveToken.address,
      ZERO_ADDRESS,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )

  const compChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  )
  const compAsset: Asset = <Asset>(
    await AssetFactory.deploy(
      fp('1'),
      compChainlinkFeed.address,
      compToken.address,
      ZERO_ADDRESS,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )

  // Register reward tokens
  await assetRegistry.connect(owner).register(aaveAsset.address)
  await assetRegistry.connect(owner).register(compAsset.address)

  const rToken: TestIRToken = <TestIRToken>(
    await ethers.getContractAt('TestIRToken', await main.rToken())
  )
  const rTokenAsset: RTokenAsset = <RTokenAsset>(
    await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
  )

  const broker: TestIBroker = <TestIBroker>(
    await ethers.getContractAt('TestIBroker', await main.broker())
  )

  const furnace: TestIFurnace = <TestIFurnace>(
    await ethers.getContractAt('TestIFurnace', await main.furnace())
  )
  const stRSR: TestIStRSR = <TestIStRSR>await ethers.getContractAt('TestIStRSR', await main.stRSR())

  // Deploy collateral for Main
  const { erc20s, collateral, basket, basketsNeededAmts } = await collateralFixture(
    oracleLib,
    compoundMock,
    aaveToken,
    compToken,
    config
  )

  const rsrTrader = <TestIRevenueTrader>(
    await ethers.getContractAt('TestIRevenueTrader', await main.rsrTrader())
  )
  const rTokenTrader = <TestIRevenueTrader>(
    await ethers.getContractAt('TestIRevenueTrader', await main.rTokenTrader())
  )

  // Register prime collateral
  const basketERC20s = []
  for (let i = 0; i < basket.length; i++) {
    await assetRegistry.connect(owner).register(basket[i].address)
    basketERC20s.push(await basket[i].erc20())
  }

  // Basket should begin disabled at 0 len
  expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

  // Set non-empty basket
  await basketHandler.connect(owner).setPrimeBasket(basketERC20s, basketsNeededAmts)
  await basketHandler.connect(owner).refreshBasket()

  // Set up allowances
  for (let i = 0; i < basket.length; i++) {
    await backingManager.grantRTokenAllowance(await basket[i].erc20())
  }

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundMock,
    aaveToken,
    aaveAsset,
    erc20s,
    collateral,
    basket,
    basketsNeededAmts,
    config,
    dist,
    deployer,
    main,
    assetRegistry,
    backingManager,
    basketHandler,
    distributor,
    rToken,
    rTokenAsset,
    furnace,
    stRSR,
    broker,
    gnosis,
    easyAuction,
    facade,
    facadeAct,
    facadeTest,
    rsrTrader,
    rTokenTrader,
    oracleLib,
    permitLib,
  }
}
