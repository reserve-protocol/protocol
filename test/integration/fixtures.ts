import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../common/blockchain-utils'
import {
  IConfig,
  IImplementations,
  IMonitorParams,
  IRevenueShare,
  networkConfig,
} from '../../common/configuration'
import { PAUSER, SHORT_FREEZER, LONG_FREEZER, ZERO_ADDRESS } from '../../common/constants'
import { expectInReceipt } from '../../common/events'
import { advanceTime } from '../utils/time'
import { bn, fp } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  ActFacet,
  Asset,
  AssetRegistryP1,
  ATokenFiatCollateral,
  ATokenMock,
  BackingManagerP1,
  BasketHandlerP1,
  BasketLibP1,
  BrokerP1,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenNonFiatCollateral,
  CTokenSelfReferentialCollateral,
  DeployerP0,
  DeployerP1,
  DistributorP1,
  DutchTrade,
  EasyAuction,
  ERC20Mock,
  EURFiatCollateral,
  FacadeTest,
  FiatCollateral,
  FurnaceP1,
  GnosisTrade,
  IAssetRegistry,
  IERC20Metadata,
  MainP1,
  NonFiatCollateral,
  ReadFacet,
  RevenueTraderP1,
  RTokenAsset,
  RTokenP1,
  SelfReferentialCollateral,
  StaticATokenLM,
  StRSRP1Votes,
  TestIBackingManager,
  TestIBasketHandler,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFacade,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  RecollateralizationLibP1,
  FacadeMonitor,
} from '../../typechain'
import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../fixtures'

interface RSRFixture {
  rsr: ERC20Mock
}

async function rsrFixture(): Promise<RSRFixture> {
  const chainId = await getChainId(hre)
  const rsr: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.RSR || '')
  )
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
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get COMP token
  const compToken: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.COMP || '')
  )

  // Get AAVE token
  const aaveToken: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.stkAAVE || '')
  )

  // Get WETH
  const weth: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WETH || '')
  )

  // Get Comp and Aave contracts
  const compoundMock: ComptrollerMock = <ComptrollerMock>(
    await ethers.getContractAt('ComptrollerMock', networkConfig[chainId].COMPTROLLER || '')
  )

  const aaveMock: AaveLendingPoolMock = <AaveLendingPoolMock>(
    await ethers.getContractAt(
      'AaveLendingPoolMock',
      networkConfig[chainId].AAVE_LENDING_POOL || ''
    )
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
  easyAuction: EasyAuction
}

async function gnosisFixture(): Promise<ModuleFixture> {
  const chainId = await getChainId(hre)
  const easyAuction: EasyAuction = <EasyAuction>(
    await ethers.getContractAt('EasyAuction', networkConfig[chainId].GNOSIS_EASY_AUCTION || '')
  )
  return { easyAuction: easyAuction }
}

interface CollateralFixture {
  erc20s: IERC20Metadata[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketsNeededAmts: BigNumber[] // reference amounts
}

export async function collateralFixture(
  aaveLendingPool: AaveLendingPoolMock,
  config: IConfig
): Promise<CollateralFixture> {
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')
  const FiatCollateralFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral')
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')

  const NonFiatCollateralFactory = await ethers.getContractFactory('NonFiatCollateral')

  const CTokenNonFiatCollateralFactory = await ethers.getContractFactory('CTokenNonFiatCollateral')

  const SelfRefCollateralFactory = await ethers.getContractFactory('SelfReferentialCollateral')

  const CTokenSelfReferentialCollateralFactory = await ethers.getContractFactory(
    'CTokenSelfReferentialCollateral'
  )

  const EURFiatCollateralFactory = await ethers.getContractFactory('EURFiatCollateral')

  const defaultThreshold = fp('0.01') // 1%
  const delayUntilDefault = bn('86400') // 24h

  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (
    tokenAddr: string,
    chainlinkAddr: string
  ): Promise<[IERC20Metadata, FiatCollateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>await ethers.getContractAt('ERC20Mock', tokenAddr)
    const coll = <FiatCollateral>await FiatCollateralFactory.deploy({
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: chainlinkAddr,
      oracleError: ORACLE_ERROR,
      erc20: erc20.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold,
      delayUntilDefault,
    })
    await coll.refresh()
    return [erc20, coll]
  }

  const makeCTokenCollateral = async (
    tokenAddress: string,
    chainlinkAddr: string
  ): Promise<[IERC20Metadata, CTokenFiatCollateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>(
      await ethers.getContractAt('CTokenMock', tokenAddress)
    )
    const coll = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: chainlinkAddr,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      REVENUE_HIDING
    )
    await coll.refresh()
    return [erc20, coll]
  }

  const makeATokenCollateral = async (
    tokenAddress: string,
    chainlinkAddr: string
  ): Promise<[IERC20Metadata, ATokenFiatCollateral]> => {
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

    const coll = <ATokenFiatCollateral>await ATokenCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: chainlinkAddr,
        oracleError: ORACLE_ERROR,
        erc20: staticErc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      REVENUE_HIDING
    )
    await coll.refresh()
    return [staticErc20 as IERC20Metadata, coll]
  }

  const makeNonFiatCollateral = async (
    nonFiatTokenAddress: string,
    referenceUnitOracleAddr: string,
    targetUnitOracleAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, NonFiatCollateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', nonFiatTokenAddress)

    const coll = <NonFiatCollateral>await NonFiatCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: referenceUnitOracleAddr,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String(targetName),
        defaultThreshold,
        delayUntilDefault,
      },
      targetUnitOracleAddr,
      ORACLE_TIMEOUT
    )
    await coll.refresh()
    return [erc20, coll]
  }

  const makeCTokenNonFiatCollateral = async (
    tokenAddress: string,
    referenceUnitOracleAddr: string,
    targetUnitOracleAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, CTokenNonFiatCollateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>(
      await ethers.getContractAt('CTokenMock', tokenAddress)
    )
    const coll = <CTokenNonFiatCollateral>await CTokenNonFiatCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: referenceUnitOracleAddr,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String(targetName),
        defaultThreshold,
        delayUntilDefault,
      },
      targetUnitOracleAddr,
      ORACLE_TIMEOUT,
      REVENUE_HIDING
    )
    await coll.refresh()
    return [erc20, coll]
  }

  const makeSelfReferentialCollateral = async (
    selfRefTokenAddress: string,
    chainlinkAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, SelfReferentialCollateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', selfRefTokenAddress)
    const coll = <SelfReferentialCollateral>await SelfRefCollateralFactory.deploy({
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: chainlinkAddr,
      oracleError: ORACLE_ERROR,
      erc20: erc20.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String(targetName),
      defaultThreshold: bn(0),
      delayUntilDefault,
    })
    await coll.refresh()
    return [erc20, coll]
  }

  const makeCTokenSelfReferentialCollateral = async (
    tokenAddress: string,
    chainlinkAddr: string,
    targetName: string,
    referenceERC20Decimals: number
  ): Promise<[IERC20Metadata, CTokenSelfReferentialCollateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>(
      await ethers.getContractAt('CTokenMock', tokenAddress)
    )
    const coll = <CTokenSelfReferentialCollateral>(
      await CTokenSelfReferentialCollateralFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: chainlinkAddr,
          oracleError: ORACLE_ERROR,
          erc20: erc20.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String(targetName),
          defaultThreshold: bn(0),
          delayUntilDefault,
        },
        REVENUE_HIDING,
        referenceERC20Decimals
      )
    )
    await coll.refresh()
    return [erc20, coll]
  }

  const makeEURFiatCollateral = async (
    eurFiatTokenAddress: string,
    referenceUnitOracleAddr: string,
    targetUnitOracleAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, EURFiatCollateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', eurFiatTokenAddress)

    const coll = <EURFiatCollateral>await EURFiatCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: referenceUnitOracleAddr,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String(targetName),
        defaultThreshold,
        delayUntilDefault,
      },
      targetUnitOracleAddr,
      ORACLE_TIMEOUT
    )
    await coll.refresh()
    return [erc20, coll]
  }

  // Create all possible collateral
  const DAI_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.DAI as string
  const USDC_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.USDC as string
  const USDT_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.USDT as string
  const BUSD_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.BUSD as string
  const USDP_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.USDP as string
  const TUSD_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.TUSD as string

  const dai = await makeVanillaCollateral(
    networkConfig[chainId].tokens.DAI as string,
    DAI_USD_PRICE_FEED
  )

  const usdc = await makeVanillaCollateral(
    networkConfig[chainId].tokens.USDC as string,
    USDC_USD_PRICE_FEED
  )

  const usdt = await makeVanillaCollateral(
    networkConfig[chainId].tokens.USDT as string,
    USDT_USD_PRICE_FEED
  )

  const busd = await makeVanillaCollateral(
    networkConfig[chainId].tokens.BUSD as string,
    BUSD_USD_PRICE_FEED
  )

  const usdp = await makeVanillaCollateral(
    networkConfig[chainId].tokens.USDP as string,
    USDP_USD_PRICE_FEED
  )
  const tusd = await makeVanillaCollateral(
    networkConfig[chainId].tokens.TUSD as string,
    TUSD_USD_PRICE_FEED
  )

  const cdai = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cDAI as string,
    DAI_USD_PRICE_FEED
  )
  const cusdc = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cUSDC as string,
    USDC_USD_PRICE_FEED
  )
  const cusdt = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cUSDT as string,
    USDT_USD_PRICE_FEED
  )

  const cusdp = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cUSDP as string,
    USDP_USD_PRICE_FEED
  )

  const adai = await makeATokenCollateral(
    networkConfig[chainId].tokens.aDAI as string,
    DAI_USD_PRICE_FEED
  )
  const ausdc = await makeATokenCollateral(
    networkConfig[chainId].tokens.aUSDC as string,
    USDC_USD_PRICE_FEED
  )
  const ausdt = await makeATokenCollateral(
    networkConfig[chainId].tokens.aUSDT as string,
    USDT_USD_PRICE_FEED
  )
  const abusd = await makeATokenCollateral(
    networkConfig[chainId].tokens.aBUSD as string,
    BUSD_USD_PRICE_FEED
  )

  const ausdp = await makeATokenCollateral(
    networkConfig[chainId].tokens.aUSDP as string,
    USDP_USD_PRICE_FEED
  )

  const wbtc = await makeNonFiatCollateral(
    networkConfig[chainId].tokens.WBTC as string,
    networkConfig[chainId].chainlinkFeeds.WBTC as string,
    networkConfig[chainId].chainlinkFeeds.BTC as string,
    'BTC'
  )

  const cWBTC = await makeCTokenNonFiatCollateral(
    networkConfig[chainId].tokens.cWBTC as string,
    networkConfig[chainId].chainlinkFeeds.WBTC as string,
    networkConfig[chainId].chainlinkFeeds.BTC as string,
    'BTC'
  )

  const weth = await makeSelfReferentialCollateral(
    networkConfig[chainId].tokens.WETH as string,
    networkConfig[chainId].chainlinkFeeds.ETH as string,
    'ETH'
  )

  const cETH = await makeCTokenSelfReferentialCollateral(
    networkConfig[chainId].tokens.cETH as string,
    networkConfig[chainId].chainlinkFeeds.ETH as string,
    'ETH',
    18
  )

  // EURT chainlink feed dead, use mock
  const FeedFactory = await ethers.getContractFactory('MockV3Aggregator')
  const eurFeed = await ethers.getContractAt(
    'MockV3Aggregator',
    networkConfig[chainId].chainlinkFeeds.EUR!
  )
  const feed = await FeedFactory.deploy(8, await eurFeed.latestAnswer())
  const eurt = await makeEURFiatCollateral(
    networkConfig[chainId].tokens.EURT!,
    feed.address,
    networkConfig[chainId].chainlinkFeeds.EUR!,
    'EUR'
  )

  const erc20s = [
    dai[0],
    usdc[0],
    usdt[0],
    busd[0],
    usdp[0],
    tusd[0],
    cdai[0],
    cusdc[0],
    cusdt[0],
    cusdp[0],
    adai[0],
    ausdc[0],
    ausdt[0],
    abusd[0],
    ausdp[0],
    wbtc[0],
    cWBTC[0],
    weth[0],
    cETH[0],
    eurt[0],
  ]
  const collateral = [
    dai[1],
    usdc[1],
    usdt[1],
    busd[1],
    usdp[1],
    tusd[1],
    cdai[1],
    cusdc[1],
    cusdt[1],
    cusdp[1],
    adai[1],
    ausdc[1],
    ausdt[1],
    abusd[1],
    ausdp[1],
    wbtc[1],
    cWBTC[1],
    weth[1],
    cETH[1],
    eurt[1],
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

export interface DefaultFixture extends RSRAndCompAaveAndCollateralAndModuleFixture {
  config: IConfig
  dist: IRevenueShare
  deployer: TestIDeployer
  main: TestIMain
  assetRegistry: IAssetRegistry
  backingManager: TestIBackingManager
  basketHandler: TestIBasketHandler
  distributor: TestIDistributor
  rsrAsset: Asset
  compAsset: Asset
  aaveAsset: Asset
  rToken: TestIRToken
  rTokenAsset: RTokenAsset
  furnace: TestIFurnace
  stRSR: TestIStRSR
  facade: TestIFacade
  facadeTest: FacadeTest
  facadeMonitor: FacadeMonitor
  broker: TestIBroker
  rsrTrader: TestIRevenueTrader
  rTokenTrader: TestIRevenueTrader
}

type Fixture<T> = () => Promise<T>

// Use this fixture when the prime basket will be constant at 1 USD
export const defaultFixture: Fixture<DefaultFixture> = async function (): Promise<DefaultFixture> {
  return await makeDefaultFixture(true)
}

// Use this fixture when the prime basket needs to be set away from 1 USD
export const defaultFixtureNoBasket: Fixture<DefaultFixture> =
  async function (): Promise<DefaultFixture> {
    return await makeDefaultFixture(false)
  }

const makeDefaultFixture = async (setBasket: boolean): Promise<DefaultFixture> => {
  const signers = await ethers.getSigners()
  const owner = signers[0]
  const { rsr } = await rsrFixture()
  const { weth, compToken, compoundMock, aaveToken, aaveMock } = await compAaveFixture()
  const { easyAuction } = await gnosisFixture()
  const dist: IRevenueShare = {
    rTokenDist: bn(4000), // 2/5 RToken
    rsrDist: bn(6000), // 3/5 RSR
  }

  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Setup Config
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardRatio: bn('89139297916'), // per second. approx half life of 90 days
    unstakingDelay: bn('1209600'), // 2 weeks
    withdrawalLeak: fp('0'), // 0%; always refresh
    warmupPeriod: bn('60'), // (the delay _after_ SOUND was regained)
    reweightable: false,
    enableIssuancePremium: true,
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    batchAuctionLength: bn('900'), // 15 minutes
    dutchAuctionLength: bn('1800'), // 30 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceThrottle: {
      amtRate: fp('1e6'), // 1M RToken
      pctRate: fp('0.05'), // 5%
    },
    redemptionThrottle: {
      amtRate: fp('1e6'), // 1M RToken
      pctRate: fp('0.05'), // 5%
    },
  }

  // Setup Monitor Params based on network
  const monitorParams: IMonitorParams = {
    AAVE_V2_DATA_PROVIDER_ADDR: networkConfig[chainId].AAVE_DATA_PROVIDER ?? ZERO_ADDRESS,
  }

  // Deploy Facade
  const FacadeFactory: ContractFactory = await ethers.getContractFactory('Facade')
  const facade = await ethers.getContractAt('TestIFacade', (await FacadeFactory.deploy()).address)

  // Save ReadFacet to Facade
  const ReadFacetFactory: ContractFactory = await ethers.getContractFactory('ReadFacet')
  const readFacet = <ReadFacet>await ReadFacetFactory.deploy()
  await facade.save(
    readFacet.address,
    Object.entries(readFacet.functions).map(([fn]) => readFacet.interface.getSighash(fn))
  )

  // Save ActFacet to Facade
  const ActFacetFactory: ContractFactory = await ethers.getContractFactory('ActFacet')
  const actFacet = <ActFacet>await ActFacetFactory.deploy()
  await facade.save(
    actFacet.address,
    Object.entries(actFacet.functions).map(([fn]) => actFacet.interface.getSighash(fn))
  )

  // Deploy FacadeTest
  const FacadeTestFactory: ContractFactory = await ethers.getContractFactory('FacadeTest')
  const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()

  // Deploy FacadeMonitor - Use implementation to simplify deployments
  const FacadeMonitorFactory: ContractFactory = await ethers.getContractFactory('FacadeMonitor')
  const facadeMonitor = <FacadeMonitor>await FacadeMonitorFactory.deploy(monitorParams)

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
    'RecollateralizationLibP1'
  )
  const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
    await TradingLibFactory.deploy()
  )

  // Deploy BasketLib external library
  const BasketLibFactory: ContractFactory = await ethers.getContractFactory('BasketLibP1')
  const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()

  // Deploy RSR Asset
  const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
  const rsrAsset: Asset = <Asset>(
    await AssetFactory.deploy(
      PRICE_TIMEOUT,
      networkConfig[chainId].chainlinkFeeds.RSR || '',
      ORACLE_ERROR,
      rsr.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )
  await rsrAsset.refresh()

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
    libraries: { TradingLibP0: tradingLib.address },
  })
  let deployer: TestIDeployer = <DeployerP0>(
    await DeployerFactory.deploy(rsr.address, easyAuction.address, rsrAsset.address)
  )

  if (IMPLEMENTATION == Implementation.P1) {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory('AssetRegistryP1')
    const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

    const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
      'BackingManagerP1',
      {
        libraries: {
          RecollateralizationLibP1: tradingLib.address,
        },
      }
    )
    const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

    const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory(
      'BasketHandlerP1',
      { libraries: { BasketLibP1: basketLib.address } }
    )
    const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

    const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
    const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

    const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory('RevenueTraderP1')
    const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

    const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
    const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

    const GnosisTradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
    const gnosisTrade: GnosisTrade = <GnosisTrade>await GnosisTradeImplFactory.deploy()

    const DutchTradeImplFactory: ContractFactory = await ethers.getContractFactory('DutchTrade')
    const dutchTrade: DutchTrade = <DutchTrade>await DutchTradeImplFactory.deploy()

    const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
    const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

    const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1')
    const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

    const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes')
    const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

    // Setup Implementation addresses
    const implementations: IImplementations = {
      main: mainImpl.address,
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
      trading: {
        gnosisTrade: gnosisTrade.address,
        dutchTrade: dutchTrade.address,
      },
    }

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(
        rsr.address,
        easyAuction.address,
        rsrAsset.address,
        implementations
      )
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
  const basketHandler: TestIBasketHandler = <TestIBasketHandler>(
    await ethers.getContractAt('TestIBasketHandler', await main.basketHandler())
  )
  const distributor: TestIDistributor = <TestIDistributor>(
    await ethers.getContractAt('TestIDistributor', await main.distributor())
  )

  const aaveAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      PRICE_TIMEOUT,
      networkConfig[chainId].chainlinkFeeds.AAVE || '',
      ORACLE_ERROR,
      aaveToken.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )
  await aaveAsset.refresh()

  const compAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      PRICE_TIMEOUT,
      networkConfig[chainId].chainlinkFeeds.COMP || '',
      ORACLE_ERROR,
      compToken.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )
  await compAsset.refresh()

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
    aaveMock,
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

  if (setBasket) {
    // Set non-empty basket
    await basketHandler.connect(owner).setPrimeBasket(basketERC20s, basketsNeededAmts)
    await basketHandler.connect(owner).refreshBasket()

    // Advance time post warmup period
    await advanceTime(Number(config.warmupPeriod) + 1)
  }

  // Set up allowances
  for (let i = 0; i < basket.length; i++) {
    await backingManager.grantRTokenAllowance(await basket[i].erc20())
  }

  // Set Owner as Pauser/Freezer for tests
  await main.connect(owner).grantRole(PAUSER, owner.address)
  await main.connect(owner).grantRole(SHORT_FREEZER, owner.address)
  await main.connect(owner).grantRole(LONG_FREEZER, owner.address)

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundMock,
    aaveMock,
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
    easyAuction,
    facade,
    facadeTest,
    facadeMonitor,
    rsrTrader,
    rTokenTrader,
  }
}
