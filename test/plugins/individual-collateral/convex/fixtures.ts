import { ethers } from 'hardhat'
import { ContractFactory, Event } from 'ethers'
import {
  COMP,
  RSR,
  MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  FIX_ONE,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  THREE_POOL,
  USDT_USD_FEED,
  USDC_USD_FEED,
  DAI_USD_FEED,
  THREE_POOL_TOKEN,
} from './constants'
import {
  exp
} from './helpers'
import {
  GnosisMock,
  EasyAuction,
  MainP1,
  RewardableLibP1,
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  DistributorP1,
  RevenueTraderP1,
  FurnaceP1,
  GnosisTrade,
  BrokerP1,
  RTokenP1,
  StRSRP1Votes,
  DeployerP1,
  RecollateralizationLibP1,
  PermitLib,
  TestIMain,
  IAssetRegistry,
  TestIBackingManager,
  IBasketHandler,
  TestIDistributor,
  TestIRToken,
  RTokenAsset,
  FacadeRead,
  FacadeTest,
  ERC20Mock,
  Asset,
  CvxCurveStableLPCollateral,
  CvxCurveStableLPCollateral__factory,
} from '../../../../typechain'

const RSR_PRICE_FEED = '0x759bBC1be8F90eE6457C44abc7d443842a976d02'
const COMP_PRICE_FEED = '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5'
const GNOSIS_EASY_AUCTION = '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101'

interface GnosisFixture {
  gnosis: GnosisMock
  easyAuction: EasyAuction
}

async function gnosisFixture(): Promise<GnosisFixture> {
  const GnosisFactory: ContractFactory = await ethers.getContractFactory('GnosisMock')

  return {
    gnosis: <GnosisMock>await GnosisFactory.deploy(),
    easyAuction: <EasyAuction>await ethers.getContractAt('EasyAuction', GNOSIS_EASY_AUCTION),
  }
}

interface IComponents {
  assetRegistry: string
  backingManager: string
  basketHandler: string
  broker: string
  distributor: string
  furnace: string
  rsrTrader: string
  rTokenTrader: string
  rToken: string
  stRSR: string
}

interface IImplementations {
  main: string
  trade: string
  components: IComponents
}

export const makeReserveProtocol = async () => {
  // Setup ERC20 mocks
  const rsr = <ERC20Mock>await ethers.getContractAt('ERC20Mock', RSR)
  const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

  // Setup Assets
  const compAsset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(FIX_ONE, COMP_PRICE_FEED, COMP, MAX_TRADE_VOL, ORACLE_TIMEOUT)
  )

  const rsrAsset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(exp(7, 15), RSR_PRICE_FEED, RSR, MAX_TRADE_VOL, ORACLE_TIMEOUT)
  )

  // Deploy implementations
  const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
  const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

  // Deploy RewardableLib external library
  const RewardableLibFactory: ContractFactory = await ethers.getContractFactory('RewardableLibP1')
  const rewardableLib: RewardableLibP1 = <RewardableLibP1>await RewardableLibFactory.deploy()

  const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
    'RecollateralizationLibP1'
  )
  const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
    await TradingLibFactory.deploy()
  )

  const PermitLibFactory: ContractFactory = await ethers.getContractFactory('PermitLib')
  const permitLib: PermitLib = <PermitLib>await PermitLibFactory.deploy()

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

  const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory('BasketHandlerP1')
  const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

  const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
  const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

  const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory('RevenueTraderP1', {
    libraries: { RewardableLibP1: rewardableLib.address },
  })
  const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

  const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
  const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

  const TradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
  const tradeImpl: GnosisTrade = <GnosisTrade>await TradeImplFactory.deploy()

  const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
  const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

  const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1', {
    libraries: {
      RewardableLibP1: rewardableLib.address,
      PermitLib: permitLib.address,
    },
  })
  const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

  const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes', {
    libraries: { PermitLib: permitLib.address },
  })
  const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

  // Setup Implementation addresses
  const implementations: IImplementations = {
    main: mainImpl.address,
    trade: tradeImpl.address,
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
  const { gnosis } = await gnosisFixture()

  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
  const deployer = <DeployerP1>(
    await DeployerFactory.deploy(rsr.address, gnosis.address, rsrAsset.address, implementations)
  )

  const config = {
    dist: {
      rTokenDist: 40n, // 2/5 RToken
      rsrDist: 60n, // 3/5 RSR
    },
    minTradeVolume: exp(1, 22), // $10k
    rTokenMaxTradeVolume: exp(1, 24), // $1M
    shortFreeze: 259200n, // 3 days
    longFreeze: 2592000n, // 30 days
    rewardPeriod: 604800n, // 1 week
    rewardRatio: exp(2284, 13), // approx. half life of 30 pay periods
    unstakingDelay: 1209600n, // 2 weeks
    tradingDelay: 0n, // (the delay _after_ default has been confirmed)
    auctionLength: 900n, // 15 minutes
    backingBuffer: exp(1, 14), // 0.01%
    maxTradeSlippage: exp(1, 16), // 1%
    issuanceRate: exp(25, 13), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: exp(5, 16), // 5%
    redemptionRateFloor: exp(1000000, 18), // 1M RToken
  }
  // Deploy actual contracts
  const [owner] = await ethers.getSigners()
  const receipt = await (
    await deployer.deploy('RTKN RToken', 'RTKN', 'mandate', owner.address, config)
  ).wait()
  const event = receipt!.events!.find((e: Event) => e.event === 'RTokenCreated')
  const mainAddr = event!.args!.main
  const main: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
  const rToken: TestIRToken = <TestIRToken>(
    await ethers.getContractAt('TestIRToken', await main.rToken())
  )

  // Get Core
  const assetRegistry: IAssetRegistry = <IAssetRegistry>(
    await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
  )

  // Deploy FacadeRead
  const FacadeReadFactory: ContractFactory = await ethers.getContractFactory('FacadeRead')
  const facade = <FacadeRead>await FacadeReadFactory.deploy()

  // Deploy FacadeTest
  const FacadeTestFactory: ContractFactory = await ethers.getContractFactory('FacadeTest')
  const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()

  const backingManager: TestIBackingManager = <TestIBackingManager>(
    await ethers.getContractAt('TestIBackingManager', await main.backingManager())
  )
  const basketHandler: IBasketHandler = <IBasketHandler>(
    await ethers.getContractAt('IBasketHandler', await main.basketHandler())
  )
  const distributor: TestIDistributor = <TestIDistributor>(
    await ethers.getContractAt('TestIDistributor', await main.distributor())
  )

  const rTokenAsset: RTokenAsset = <RTokenAsset>(
    await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
  )

  const collateral = await deployCollateral()

  // Register an Asset and a Collateral
  await assetRegistry.connect(owner).register(compAsset.address)
  await assetRegistry.connect(owner).register(collateral.address)

  // Set initial Basket
  const collateralERC20 = await collateral.erc20()
  await basketHandler.connect(owner).setPrimeBasket([collateralERC20], [FIX_ONE]) // CUSDC_V3 is 100% of Basket
  await basketHandler.connect(owner).refreshBasket()

  // Set up allowances
  await backingManager.grantRTokenAllowance(collateralERC20)

  return {
    assetRegistry,
    basketHandler,
    collateral,
    rTokenAsset,
    facade,
    rToken,
    rsrAsset,
    compAsset,
    rsr,
    compToken,
    facadeTest,
    backingManager,
    main,
  }
}

interface CollateralOpts {
  wrappedStakeToken?: string
  lpToken?: string
  nTokens?: number
  tokensPriceFeeds?: string[][]
  targetPegFeed?: string
  curvePool?: string
  targetName?: string
  oracleTimeout?: bigint
  fallbackPrice?: bigint
  maxTradeVolume?: bigint
  poolRatioThreshold?: bigint
  defaultThreshold?: bigint
  delayUntilDefault?: bigint
  poolType?: number
}

const defaultOpts: CollateralOpts = {
  lpToken: THREE_POOL_TOKEN,
  nTokens: 3,
  curvePool: THREE_POOL,
  tokensPriceFeeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
  targetPegFeed: ethers.constants.AddressZero,
  targetName: ethers.utils.formatBytes32String('USD'),
  oracleTimeout: ORACLE_TIMEOUT,
  fallbackPrice: FIX_ONE,
  maxTradeVolume: MAX_TRADE_VOL,
  poolRatioThreshold: exp(3, 17), // 30%
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  poolType: 0,
}

export const deployCollateral = async (
  opts: CollateralOpts = {},
  poolId: bigint = 9n
): Promise<CvxCurveStableLPCollateral> => {
  opts = { ...defaultOpts, ...opts }

  const CvxCurveStableLPCollateralFactory = <CvxCurveStableLPCollateral__factory>(
    await ethers.getContractFactory('CvxCurveStableLPCollateral')
  )

  let newOpts: CvxCurveStableLPCollateral.ConfigurationStruct

  if (opts.wrappedStakeToken == undefined) {
    const CvxMiningFactory = await ethers.getContractFactory('CvxMining')
    const cvxMining = await CvxMiningFactory.deploy()

    const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
      libraries: {
        CvxMining: cvxMining.address,
      },
    })
    const convexStakingWrapper = await ConvexStakingWrapperFactory.deploy()
    await convexStakingWrapper.initialize(poolId)
    newOpts = <CvxCurveStableLPCollateral.ConfigurationStruct>{
      ...opts,
      wrappedStakeToken: convexStakingWrapper.address,
    }
  } else {
    newOpts = <CvxCurveStableLPCollateral.ConfigurationStruct>opts
  }

  const collateral = <CvxCurveStableLPCollateral>(
    await CvxCurveStableLPCollateralFactory.deploy(newOpts)
  )

  return collateral
}
