import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory, Contract } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, IImplementations, IRevenueShare, networkConfig } from '../../common/configuration'
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
  CTokenNonFiatCollateral,
  CTokenSelfReferentialCollateral,
  DeployerP0,
  DeployerP1,
  DistributorP1,
  ERC20Mock,
  EURFiatCollateral,
  FacadeRead,
  FacadeAct,
  FacadeTest,
  FiatCollateral,
  FurnaceP1,
  GnosisTrade,
  IAssetRegistry,
  IBasketHandler,
  IERC20Metadata,
  IGnosis,
  MainP1,
  NonFiatCollateral,
  PermitLib,
  RevenueTraderP1,
  RTokenAsset,
  RTokenP1,
  StaticATokenLM,
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
  RecollateralizationLibP1,
} from '../../typechain'

import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
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
  gnosis: IGnosis
}

async function gnosisFixture(): Promise<ModuleFixture> {
  const EasyAuctionFactory: ContractFactory = await ethers.getContractFactory('EasyAuction')
  const gnosis: IGnosis = <IGnosis>await EasyAuctionFactory.deploy()
  return { gnosis: gnosis }
}

interface CollateralFixture {
  erc20s: IERC20Metadata[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketsNeededAmts: BigNumber[] // reference amounts
}

async function collateralFixture(
  comptroller: ComptrollerMock,
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

  const SelfRefCollateralFactory = await ethers.getContractFactory('FiatCollateral')

  const CTokenSelfReferentialCollateralFactory = await ethers.getContractFactory(
    'CTokenSelfReferentialCollateral'
  )

  const EURFiatCollateralFactory = await ethers.getContractFactory('EURFiatCollateral')

  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (
    tokenAddr: string,
    chainlinkAddr: string
  ): Promise<[IERC20Metadata, FiatCollateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>await ethers.getContractAt('ERC20Mock', tokenAddr)
    const coll = <FiatCollateral>await FiatCollateralFactory.deploy({
      fallbackPrice: fp('1'),
      chainlinkFeed: chainlinkAddr,
      oracleError: ORACLE_ERROR,
      erc20: erc20.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold,
      delayUntilDefault,
    })
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
        fallbackPrice: fp('0.02'),
        chainlinkFeed: chainlinkAddr,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      comptroller.address
    )
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

    return [
      staticErc20 as IERC20Metadata,
      <ATokenFiatCollateral>await ATokenCollateralFactory.deploy({
        fallbackPrice: fp('1'),
        chainlinkFeed: chainlinkAddr,
        oracleError: ORACLE_ERROR,
        erc20: staticErc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      }),
    ]
  }

  const makeNonFiatCollateral = async (
    nonFiatTokenAddress: string,
    referenceUnitOracleAddr: string,
    targetUnitOracleAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, NonFiatCollateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', nonFiatTokenAddress)

    return [erc20, <NonFiatCollateral>await NonFiatCollateralFactory.deploy(
        {
          fallbackPrice: fp('1'),
          chainlinkFeed: referenceUnitOracleAddr,
          oracleError: ORACLE_ERROR,
          erc20: erc20.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String(targetName),
          defaultThreshold,
          delayUntilDefault,
        },
        targetUnitOracleAddr
      )]
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
    return [erc20, <CTokenNonFiatCollateral>await CTokenNonFiatCollateralFactory.deploy(
        {
          fallbackPrice: fp('1'),
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
        comptroller.address
      )]
  }

  const makeSelfReferentialCollateral = async (
    selfRefTokenAddress: string,
    chainlinkAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, FiatCollateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', selfRefTokenAddress)
    return [erc20, <FiatCollateral>await SelfRefCollateralFactory.deploy({
        fallbackPrice: fp('1'),
        chainlinkFeed: chainlinkAddr,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String(targetName),
        defaultThreshold,
        delayUntilDefault,
      })]
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
    return [
      erc20,
      <CTokenSelfReferentialCollateral>await CTokenSelfReferentialCollateralFactory.deploy(
        {
          fallbackPrice: fp('1'),
          chainlinkFeed: chainlinkAddr,
          oracleError: ORACLE_ERROR,
          erc20: erc20.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String(targetName),
          defaultThreshold,
          delayUntilDefault,
        },
        referenceERC20Decimals,
        comptroller.address
      ),
    ]
  }

  const makeEURFiatCollateral = async (
    eurFiatTokenAddress: string,
    referenceUnitOracleAddr: string,
    targetUnitOracleAddr: string,
    targetName: string
  ): Promise<[IERC20Metadata, EURFiatCollateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ethers.getContractAt('ERC20Mock', eurFiatTokenAddress)

    return [erc20, <EURFiatCollateral>await EURFiatCollateralFactory.deploy(
        {
          fallbackPrice: fp('1'),
          chainlinkFeed: referenceUnitOracleAddr,
          oracleError: ORACLE_ERROR,
          erc20: erc20.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String(targetName),
          defaultThreshold,
          delayUntilDefault,
        },
        targetUnitOracleAddr
      )]
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

  const eurt = await makeEURFiatCollateral(
    networkConfig[chainId].tokens.EURT as string,
    networkConfig[chainId].chainlinkFeeds.EURT as string,
    networkConfig[chainId].chainlinkFeeds.EUR as string,
    'EURO'
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

interface DefaultFixture extends RSRAndCompAaveAndCollateralAndModuleFixture {
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
}

export const defaultFixture: Fixture<DefaultFixture> = async function ([
  owner,
]): Promise<DefaultFixture> {
  const { rsr } = await rsrFixture()
  const { weth, compToken, compoundMock, aaveToken, aaveMock } = await compAaveFixture()
  const { gnosis } = await gnosisFixture()
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
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
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5%
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  // Deploy PermitLib external library
  const PermitLibFactory: ContractFactory = await ethers.getContractFactory('PermitLib')
  const permitLib: PermitLib = <PermitLib>await PermitLibFactory.deploy()

  // Deploy FacadeRead
  const FacadeReadFactory: ContractFactory = await ethers.getContractFactory('FacadeRead')
  const facade = <FacadeRead>await FacadeReadFactory.deploy()

  // Deploy FacadeAct
  const FacadeActFactory: ContractFactory = await ethers.getContractFactory('FacadeAct')
  const facadeAct = <FacadeAct>await FacadeActFactory.deploy()

  // Deploy FacadeTest
  const FacadeTestFactory: ContractFactory = await ethers.getContractFactory('FacadeTest')
  const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
    'RecollateralizationLibP1'
  )
  const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
    await TradingLibFactory.deploy()
  )

  // Deploy RSR Asset
  const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
  const rsrAsset: Asset = <Asset>(
    await AssetFactory.deploy(
      fp('0.007'),
      networkConfig[chainId].chainlinkFeeds.RSR || '',
      ORACLE_ERROR,
      rsr.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
    libraries: { TradingLibP0: tradingLib.address, PermitLib: permitLib.address },
  })
  let deployer: TestIDeployer = <DeployerP0>(
    await DeployerFactory.deploy(rsr.address, gnosis.address, rsrAsset.address)
  )

  if (IMPLEMENTATION == Implementation.P1) {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    // Deploy RewardableLib external library
    const RewardableLibFactory: ContractFactory = await ethers.getContractFactory('RewardableLibP1')
    const rewardableLib: Contract = <Contract>await RewardableLibFactory.deploy()

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

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(rsr.address, gnosis.address, rsrAsset.address, implementations)
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

  const aaveAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.AAVE || '',
      ORACLE_ERROR,
      aaveToken.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
  )

  const compAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.COMP || '',
      ORACLE_ERROR,
      compToken.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )
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
    gnosis,
    facade,
    facadeAct,
    facadeTest,
    rsrTrader,
    rTokenTrader,
  }
}
