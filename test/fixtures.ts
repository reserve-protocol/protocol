import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { expectInReceipt } from '../common/events'
import { bn, fp } from '../common/numbers'
import {
  AaveLendingAddrProviderMock,
  AaveLendingPoolMock,
  AaveOracleMock,
  Asset,
  AssetRegistryP0,
  ATokenFiatCollateral,
  BackingManagerP0,
  BasketHandlerP0,
  BrokerP0,
  Collateral as AbstractCollateral,
  CompoundOracleMock,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  DeployerP0,
  DeployerP1,
  DistributorP0,
  FacadeP0,
  FurnaceP0,
  GnosisMock,
  MainP0,
  RevenueTradingP0,
  RTokenAsset,
  StaticATokenMock,
  TestIDeployer,
  TestIRToken,
  TestIStRSR,
  TradingLibP0,
  USDCMock,
} from '../typechain'

export enum Implementation {
  P0,
  P1,
}

export const IMPLEMENTATION: Implementation =
  process.env.PROTO_IMPL == Implementation.P1.toString() ? Implementation.P1 : Implementation.P0

export const TURBO = process.env.TURBO !== 'off'

export type Collateral = AbstractCollateral | CTokenFiatCollateral | ATokenFiatCollateral

export interface IConfig {
  maxTradeVolume: BigNumber
  dist: IRevenueShare
  rewardPeriod: BigNumber
  rewardRatio: BigNumber
  unstakingDelay: BigNumber
  tradingDelay: BigNumber
  auctionLength: BigNumber
  backingBuffer: BigNumber
  maxTradeSlippage: BigNumber
  dustAmount: BigNumber
  issuanceRate: BigNumber
}

export interface IRevenueShare {
  rTokenDist: BigNumber
  rsrDist: BigNumber
}

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
  compoundOracleInternal: CompoundOracleMock
  compoundMock: ComptrollerMock
  aaveToken: ERC20Mock
  aaveOracleInternal: AaveOracleMock
  aaveMock: AaveLendingPoolMock
}

async function compAaveFixture(): Promise<COMPAAVEFixture> {
  // Deploy COMP token and Asset
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')

  // Deploy AAVE token and Asset
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')

  // Deploy Comp and Aave Oracle Mocks
  const CompoundOracleMockFactory: ContractFactory = await ethers.getContractFactory(
    'CompoundOracleMock'
  )
  const compoundOracleInternal: CompoundOracleMock = <CompoundOracleMock>(
    await CompoundOracleMockFactory.deploy()
  )

  const ComptrollerMockFactory: ContractFactory = await ethers.getContractFactory('ComptrollerMock')
  const compoundMock: ComptrollerMock = <ComptrollerMock>(
    await ComptrollerMockFactory.deploy(compoundOracleInternal.address)
  )
  await compoundMock.setCompToken(compToken.address)

  const AaveOracleMockFactory: ContractFactory = await ethers.getContractFactory('AaveOracleMock')
  const weth: ERC20Mock = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')
  const aaveOracleInternal: AaveOracleMock = <AaveOracleMock>(
    await AaveOracleMockFactory.deploy(weth.address)
  )

  const AaveAddrProviderFactory: ContractFactory = await ethers.getContractFactory(
    'AaveLendingAddrProviderMock'
  )
  const aaveAddrProvider: AaveLendingAddrProviderMock = <AaveLendingAddrProviderMock>(
    await AaveAddrProviderFactory.deploy(aaveOracleInternal.address)
  )

  const AaveLendingPoolMockFactory: ContractFactory = await ethers.getContractFactory(
    'AaveLendingPoolMock'
  )
  const aaveMock: AaveLendingPoolMock = <AaveLendingPoolMock>(
    await AaveLendingPoolMockFactory.deploy(aaveAddrProvider.address)
  )

  return {
    weth,
    compToken,
    compoundOracleInternal,
    compoundMock,
    aaveToken,
    aaveOracleInternal,
    aaveMock,
  }
}

interface ModuleFixture {
  gnosis: GnosisMock
}

async function gnosisFixture(): Promise<ModuleFixture> {
  const GnosisMockFactory: ContractFactory = await ethers.getContractFactory('GnosisMock')
  const gnosisMock: GnosisMock = <GnosisMock>await GnosisMockFactory.deploy()
  return { gnosis: gnosisMock }
}

interface CollateralFixture {
  erc20s: ERC20Mock[] // all erc20 addresses
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
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const USDC: ContractFactory = await ethers.getContractFactory('USDCMock')
  const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
  const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
  const AaveCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'AavePricedFiatCollateral'
  )
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')
  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (symbol: string): Promise<[ERC20Mock, Collateral]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ERC20.deploy(symbol + ' Token', symbol)
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
  const makeSixDecimalCollateral = async (symbol: string): Promise<[USDCMock, Collateral]> => {
    const erc20: USDCMock = <USDCMock>await USDC.deploy(symbol + ' Token', symbol)
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
    symbol: string,
    underlyingAddress: string,
    compToken: ERC20Mock
  ): Promise<[CTokenMock, CTokenFiatCollateral]> => {
    const erc20: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
    )
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
    symbol: string,
    underlyingAddress: string,
    aaveToken: ERC20Mock
  ): Promise<[StaticATokenMock, ATokenFiatCollateral]> => {
    const erc20: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
    )

    // Set reward token
    await erc20.setAaveToken(aaveToken.address)

    return [
      erc20,
      <ATokenFiatCollateral>(
        await ATokenCollateralFactory.deploy(
          erc20.address,
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
  const dai = await makeVanillaCollateral('DAI')
  const usdc = await makeSixDecimalCollateral('USDC')
  const usdt = await makeVanillaCollateral('USDT')
  const busd = await makeVanillaCollateral('BUSD')
  const cdai = await makeCTokenCollateral('cDAI', dai[0].address, compToken)
  const cusdc = await makeCTokenCollateral('cUSDC', usdc[0].address, compToken)
  const cusdt = await makeCTokenCollateral('cUSDT', usdt[0].address, compToken)
  const adai = await makeATokenCollateral('aDAI', dai[0].address, aaveToken)
  const ausdc = await makeATokenCollateral('aUSDC', usdc[0].address, aaveToken)
  const ausdt = await makeATokenCollateral('aUSDT', usdt[0].address, aaveToken)
  const abusd = await makeATokenCollateral('aBUSD', busd[0].address, aaveToken)
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
  ModuleFixture

interface DefaultFixture extends RSRAndCompAaveAndCollateralAndModuleFixture {
  config: IConfig
  dist: IRevenueShare
  deployer: TestIDeployer
  main: MainP0
  assetRegistry: AssetRegistryP0
  backingManager: BackingManagerP0
  basketHandler: BasketHandlerP0
  distributor: DistributorP0
  rsrAsset: Asset
  compAsset: Asset
  aaveAsset: Asset
  rToken: TestIRToken
  rTokenAsset: RTokenAsset
  furnace: FurnaceP0
  stRSR: TestIStRSR
  facade: FacadeP0
  broker: BrokerP0
  rsrTrader: RevenueTradingP0
  rTokenTrader: RevenueTradingP0
}

export const defaultFixture: Fixture<DefaultFixture> = async function ([
  owner,
]): Promise<DefaultFixture> {
  const { rsr } = await rsrFixture()
  const {
    weth,
    compToken,
    compoundOracleInternal,
    compoundMock,
    aaveToken,
    aaveOracleInternal,
    aaveMock,
  } = await compAaveFixture()
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
  }

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP0')
  const tradingLib: TradingLibP0 = <TradingLibP0>await TradingLibFactory.deploy()

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
      aaveMock.address
    )
  )

  if (IMPLEMENTATION == Implementation.P1) {
    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1', {
      libraries: { TradingLibP0: tradingLib.address },
    })
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(
        rsr.address,
        compToken.address,
        aaveToken.address,
        gnosis.address,
        compoundMock.address,
        aaveMock.address
      )
    )
  }

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy('RTKN RToken', 'RTKN', 'constitution', owner.address, config)
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
  const facadeAddr = expectInReceipt(receipt, 'RTokenCreated').args.facade
  const main: MainP0 = <MainP0>await ethers.getContractAt('MainP0', mainAddr)

  // Get Core
  const assetRegistry: AssetRegistryP0 = <AssetRegistryP0>(
    await ethers.getContractAt('AssetRegistryP0', await main.assetRegistry())
  )
  const backingManager: BackingManagerP0 = <BackingManagerP0>(
    await ethers.getContractAt('BackingManagerP0', await main.backingManager())
  )
  const basketHandler: BasketHandlerP0 = <BasketHandlerP0>(
    await ethers.getContractAt('BasketHandlerP0', await main.basketHandler())
  )
  const distributor: DistributorP0 = <DistributorP0>(
    await ethers.getContractAt('DistributorP0', await main.distributor())
  )

  const rsrAsset: Asset = <Asset>(
    await ethers.getContractAt('AavePricedAsset', await assetRegistry.toAsset(rsr.address))
  )

  const aaveAsset: Asset = <Asset>(
    await ethers.getContractAt('AavePricedAsset', await assetRegistry.toAsset(aaveToken.address))
  )
  const compAsset: Asset = <Asset>(
    await ethers.getContractAt(
      'CompoundPricedAsset',
      await assetRegistry.toAsset(compToken.address)
    )
  )
  const rToken: TestIRToken = <TestIRToken>(
    await ethers.getContractAt('TestIRToken', await main.rToken())
  )
  const rTokenAsset: RTokenAsset = <RTokenAsset>(
    await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
  )

  const broker: BrokerP0 = <BrokerP0>await ethers.getContractAt('BrokerP0', await main.broker())

  const furnace: FurnaceP0 = <FurnaceP0>(
    await ethers.getContractAt('FurnaceP0', await main.furnace())
  )
  const stRSR: TestIStRSR = <TestIStRSR>await ethers.getContractAt('TestIStRSR', await main.stRSR())

  const facade: FacadeP0 = <FacadeP0>await ethers.getContractAt('FacadeP0', facadeAddr)

  // Deploy collateral for Main
  const { erc20s, collateral, basket, basketsNeededAmts } = await collateralFixture(
    compoundMock,
    aaveMock,
    aaveToken,
    compToken,
    config
  )

  const rsrTrader = <RevenueTradingP0>(
    await ethers.getContractAt('RevenueTradingP0', await main.rsrTrader())
  )
  const rTokenTrader = <RevenueTradingP0>(
    await ethers.getContractAt('RevenueTradingP0', await main.rTokenTrader())
  )

  // Set Oracle Prices
  await compoundOracleInternal.setPrice('ETH', bn('4000e6'))
  await compoundOracleInternal.setPrice('COMP', bn('1e6'))
  await aaveOracleInternal.setPrice(weth.address, bn('1e18'))
  await aaveOracleInternal.setPrice(aaveToken.address, bn('2.5e14'))
  await aaveOracleInternal.setPrice(compToken.address, bn('2.5e14'))
  await aaveOracleInternal.setPrice(rsr.address, bn('2.5e14'))
  for (let i = 0; i < collateral.length; i++) {
    // Get erc20 and refERC20
    const erc20 = await ethers.getContractAt('ERC20Mock', await collateral[i].erc20())
    const refERC20 = await ethers.getContractAt('ERC20Mock', await collateral[i].referenceERC20())

    // Set Oracle price only if its a fiat token (exclude aTokens, cTokens, etc)
    if (erc20.address == refERC20.address) {
      await compoundOracleInternal.setPrice(await erc20.symbol(), bn('1e6'))
      await aaveOracleInternal.setPrice(erc20.address, bn('2.5e14'))
    }
  }

  // Register prime collateral
  const basketERC20s = []
  for (let i = 0; i < basket.length; i++) {
    await assetRegistry.connect(owner).register(basket[i].address)
    basketERC20s.push(await basket[i].erc20())
  }

  // Set non-empty basket
  await basketHandler.connect(owner).setPrimeBasket(basketERC20s, basketsNeededAmts)
  await basketHandler.connect(owner).switchBasket()

  // Unpause
  await main.connect(owner).unpause()

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundOracleInternal,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracleInternal,
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
