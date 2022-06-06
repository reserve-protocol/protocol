import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { expectInReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  Asset,
  AssetRegistryP1,
  ATokenFiatCollateral,
  ATokenMock,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  ComptrollerMock,
  CTokenFiatCollateral,
  ERC20Mock,
  DeployerP0,
  DeployerP1,
  Facade,
  DistributorP1,
  FurnaceP1,
  GnosisTrade,
  IBasketHandler,
  IERC20,
  IGnosis,
  MainP1,
  RevenueTraderP1,
  RewardableLibP1,
  RTokenAsset,
  RTokenP1,
  StaticATokenLM,
  StRSRP1Votes,
  TestIAssetRegistry,
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
  TradingLibP1,
} from '../../typechain'

import {
  Collateral,
  IConfig,
  IImplementations,
  Implementation,
  IMPLEMENTATION,
  IRevenueShare,
} from '../fixtures'
import {
  STAKEDAAVE_ADDRESS,
  AAVE_LENDING_POOL_ADDRESS,
  COMP_ADDRESS,
  COMPTROLLER_ADDRESS,
  WETH_ADDRESS,
  DAI_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  BUSD_ADDRESS,
  AUSDC_ADDRESS,
  AUSDT_ADDRESS,
  ADAI_ADDRESS,
  ABUSD_ADDRESS,
  CUSDC_ADDRESS,
  CUSDT_ADDRESS,
  CDAI_ADDRESS,
} from './mainnet'

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
  aaveMock: AaveLendingPoolMock
}

async function compAaveFixture(): Promise<COMPAAVEFixture> {
  // Get COMP token
  const compToken: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP_ADDRESS)

  // Get AAVE token
  const aaveToken: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', STAKEDAAVE_ADDRESS)
  )

  // Get WETH
  const weth: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', WETH_ADDRESS)

  // Get Comp and Aave contracts
  const compoundMock: ComptrollerMock = <ComptrollerMock>(
    await ethers.getContractAt('ComptrollerMock', COMPTROLLER_ADDRESS)
  )

  const aaveMock: AaveLendingPoolMock = <AaveLendingPoolMock>(
    await ethers.getContractAt('AaveLendingPoolMock', AAVE_LENDING_POOL_ADDRESS)
  )

  return {
    weth,
    compToken,
    compoundMock,
    aaveToken,
    aaveMock,
  }
}

interface ModuleFixture {
  gnosis: IGnosis
}

async function gnosisFixture(): Promise<ModuleFixture> {
  const EasyAuctionFactory: ContractFactory = await ethers.getContractFactory('EasyAuction')
  const gnosis: IGnosis = <IGnosis>await EasyAuctionFactory.deploy()
  return { gnosis: gnosis }
}

interface CollateralFixture {
  erc20s: IERC20[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketsNeededAmts: BigNumber[] // reference amounts
}

async function collateralFixture(
  comptroller: ComptrollerMock,
  aaveLendingPool: AaveLendingPoolMock,
  aaveToken: ERC20Mock,
  compToken: ERC20Mock,
  config: IConfig
): Promise<CollateralFixture> {
  const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')
  const AaveCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'AavePricedFiatCollateral'
  )
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')
  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (tokenAddr: string): Promise<[IERC20, Collateral]> => {
    const erc20: IERC20 = <IERC20>await ethers.getContractAt('ERC20Mock', tokenAddr)
    return [
      erc20,
      <Collateral>(
        await AaveCollateralFactory.deploy(
          erc20.address,
          config.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          comptroller.address,
          aaveLendingPool.address
        )
      ),
    ]
  }

  const makeSixDecimalCollateral = async (tokenAddr: string): Promise<[IERC20, Collateral]> => {
    const erc20: IERC20 = <IERC20>await ethers.getContractAt('USDCMock', tokenAddr)
    return [
      erc20,
      <Collateral>(
        await AaveCollateralFactory.deploy(
          erc20.address,
          config.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          comptroller.address,
          aaveLendingPool.address
        )
      ),
    ]
  }

  const makeCTokenCollateral = async (
    tokenAddress: string,
    underlyingAddress: string,
    compToken: ERC20Mock
  ): Promise<[IERC20, CTokenFiatCollateral]> => {
    const erc20: IERC20 = <IERC20>await ethers.getContractAt('CTokenMock', tokenAddress)
    return [
      erc20,
      <CTokenFiatCollateral>(
        await CTokenCollateralFactory.deploy(
          erc20.address,
          config.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          underlyingAddress,
          comptroller.address,
          compToken.address
        )
      ),
    ]
  }

  const makeATokenCollateral = async (
    tokenAddress: string,
    underlyingAddress: string,
    aaveToken: ERC20Mock
  ): Promise<[IERC20, ATokenFiatCollateral]> => {
    const erc20: ATokenMock = <ATokenMock>await ethers.getContractAt('ATokenMock', tokenAddress)
    const name: string = await erc20.name()
    const symbol: string = await erc20.symbol()

    // Wrap in Static AToken
    const staticErc20: StaticATokenLM = <StaticATokenLM>(
      await StaticATokenFactory.deploy(
        aaveLendingPool.address,
        erc20.address,
        'Static ' + name,
        'stat' + symbol
      )
    )

    return [
      staticErc20 as IERC20,
      <ATokenFiatCollateral>(
        await ATokenCollateralFactory.deploy(
          staticErc20.address,
          config.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          underlyingAddress,
          comptroller.address,
          aaveLendingPool.address,
          aaveToken.address
        )
      ),
    ]
  }

  // Create all possible collateral
  const dai = await makeVanillaCollateral(DAI_ADDRESS)
  const usdc = await makeSixDecimalCollateral(USDC_ADDRESS)
  const usdt = await makeVanillaCollateral(USDT_ADDRESS)
  const busd = await makeVanillaCollateral(BUSD_ADDRESS)
  const cdai = await makeCTokenCollateral(CDAI_ADDRESS, dai[0].address, compToken)
  const cusdc = await makeCTokenCollateral(CUSDC_ADDRESS, usdc[0].address, compToken)
  const cusdt = await makeCTokenCollateral(CUSDT_ADDRESS, usdt[0].address, compToken)
  const adai = await makeATokenCollateral(ADAI_ADDRESS, dai[0].address, aaveToken)
  const ausdc = await makeATokenCollateral(AUSDC_ADDRESS, usdc[0].address, aaveToken)
  const ausdt = await makeATokenCollateral(AUSDT_ADDRESS, usdt[0].address, aaveToken)
  const abusd = await makeATokenCollateral(ABUSD_ADDRESS, busd[0].address, aaveToken)
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
  const basket = [dai[1], adai[1], cdai[1]]
  const basketsNeededAmts = [fp('0.25'), fp('0.25'), fp('0.5')]

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
  ModuleFixture

interface DefaultFixture extends RSRAndCompAaveAndCollateralAndModuleFixture {
  config: IConfig
  dist: IRevenueShare
  deployer: TestIDeployer
  main: TestIMain
  assetRegistry: TestIAssetRegistry
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
  facade: Facade
  broker: TestIBroker
  rsrTrader: TestIRevenueTrader
  rTokenTrader: TestIRevenueTrader
}

export const defaultFixture: Fixture<DefaultFixture> = async function ([
  owner,
]): Promise<DefaultFixture> {
  let facade: Facade
  const { rsr } = await rsrFixture()
  const { weth, compToken, compoundMock, aaveToken, aaveMock } = await compAaveFixture()
  const { gnosis } = await gnosisFixture()
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }

  // Setup Config
  const config: IConfig = {
    maxTradeVolume: fp('1e6'), // $1M
    dist: dist,
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    dustAmount: fp('0.01'), // 0.01 UoA (USD)
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    oneshotPauseDuration: bn('864000'), // 10 days
    minBidSize: fp('0.001'), // 0.1% of the minBuyAmount
  }

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP0')
  const tradingLib: TradingLibP0 = <TradingLibP0>await TradingLibFactory.deploy()

  // Deploy Facade
  const FacadeFactory: ContractFactory = await ethers.getContractFactory('Facade')
  facade = <Facade>await FacadeFactory.deploy()

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
    libraries: { TradingLibP0: tradingLib.address },
  })
  let deployer: TestIDeployer = <DeployerP0>(
    await DeployerFactory.deploy(
      rsr.address,
      compToken.address,
      aaveToken.address,
      gnosis.address,
      compoundMock.address,
      aaveMock.address,
      facade.address
    )
  )

  if (IMPLEMENTATION == Implementation.P1) {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    // Deploy TradingLib external library
    const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP1')
    const tradingLib: TradingLibP1 = <TradingLibP1>await TradingLibFactory.deploy()

    // Deploy RewardableLib external library
    const RewardableLibFactory: ContractFactory = await ethers.getContractFactory('RewardableLibP1')
    const rewardableLib: RewardableLibP1 = <RewardableLibP1>await RewardableLibFactory.deploy()

    const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory('AssetRegistryP1')
    const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

    const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
      'BackingManagerP1',
      { libraries: { RewardableLibP1: rewardableLib.address, TradingLibP1: tradingLib.address } }
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
      { libraries: { RewardableLibP1: rewardableLib.address, TradingLibP1: tradingLib.address } }
    )
    const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

    const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
    const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

    const TradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
    const tradeImpl: GnosisTrade = <GnosisTrade>await TradeImplFactory.deploy()

    const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
    const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

    const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1', {
      libraries: { RewardableLibP1: rewardableLib.address },
    })
    const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

    const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes')
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

    // Deploy FacadeP1
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeP1')
    facade = <Facade>await FacadeFactory.deploy()

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(
        rsr.address,
        compToken.address,
        aaveToken.address,
        gnosis.address,
        compoundMock.address,
        aaveMock.address,
        facade.address,
        implementations
      )
    )
  }

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy('RTKN RToken', 'RTKN', 'manifesto', owner.address, config)
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
  const main: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

  // Get Core
  const assetRegistry: TestIAssetRegistry = <TestIAssetRegistry>(
    await ethers.getContractAt('TestIAssetRegistry', await main.assetRegistry())
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

  const rsrAsset: Asset = <Asset>(
    await ethers.getContractAt('AavePricedAsset', await assetRegistry.toAsset(rsr.address))
  )

  const aaveAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('StakedAaveAsset')
    ).deploy(aaveToken.address, config.maxTradeVolume, compoundMock.address, aaveMock.address)
  )

  const compAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('CompoundPricedAsset')
    ).deploy(compToken.address, config.maxTradeVolume, compoundMock.address)
  )
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
    compoundMock,
    aaveMock,
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

  // Register reward tokens
  await assetRegistry.connect(owner).register(aaveAsset.address)
  await assetRegistry.connect(owner).register(compAsset.address)

  // Register prime collateral
  const basketERC20s = []
  for (let i = 0; i < basket.length; i++) {
    await assetRegistry.connect(owner).register(basket[i].address)
    basketERC20s.push(await basket[i].erc20())
  }

  // Set non-empty basket
  await basketHandler.connect(owner).setPrimeBasket(basketERC20s, basketsNeededAmts)
  await basketHandler.connect(owner).refreshBasket()

  // Unpause
  await main.connect(owner).unpause()

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
    aaveMock,
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
    facade,
    rsrTrader,
    rTokenTrader,
  }
}
