import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { expectInReceipt } from '../../../common/events'
import { bn, fp } from '../../../common/numbers'
import { ATokenFiatCollateralP0 } from '../../../typechain/ATokenFiatCollateralP0'
import { AaveClaimAdapterP0 } from '../../../typechain/AaveClaimAdapterP0'
import { AaveLendingAddrProviderMockP0 } from '../../../typechain/AaveLendingAddrProviderMockP0'
import { AaveLendingPoolMockP0 } from '../../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../../typechain/AaveOracleMockP0'
import { AavePricedAssetP0 } from '../../../typechain/AavePricedAssetP0'
import { AssetP0 } from '../../../typechain/AssetP0'
import { AssetRegistryP0 } from '../../../typechain/AssetRegistryP0'
import { AuctioneerP0 } from '../../../typechain/AuctioneerP0'
import { BasketHandlerP0 } from '../../../typechain/BasketHandlerP0'
import { CTokenFiatCollateralP0 } from '../../../typechain/CTokenFiatCollateralP0'
import { CTokenMock } from '../../../typechain/CTokenMock'
import { CollateralP0 } from '../../../typechain/CollateralP0'
import { CompoundClaimAdapterP0 } from '../../../typechain/CompoundClaimAdapterP0'
import { CompoundOracleMockP0 } from '../../../typechain/CompoundOracleMockP0'
import { CompoundPricedAssetP0 } from '../../../typechain/CompoundPricedAssetP0'
import { ComptrollerMockP0 } from '../../../typechain/ComptrollerMockP0'
import { DeployerP0 } from '../../../typechain/DeployerP0'
import { ERC20Mock } from '../../../typechain/ERC20Mock'
import { ExplorerFacadeP0 } from '../../../typechain/ExplorerFacadeP0'
import { FurnaceP0 } from '../../../typechain/FurnaceP0'
import { MainP0 } from '../../../typechain/MainP0'
import { MarketMock } from '../../../typechain/MarketMock'
import { RTokenAssetP0 } from '../../../typechain/RTokenAssetP0'
import { RTokenIssuerP0 } from '../../../typechain/RTokenIssuerP0'
import { RTokenP0 } from '../../../typechain/RTokenP0'
import { RevenueDistributorP0 } from '../../../typechain/RevenueDistributorP0'
import { RevenueTraderP0 } from '../../../typechain/RevenueTraderP0'
import { RewardClaimerP0 } from '../../../typechain/RewardClaimerP0'
import { SettingsP0 } from '../../../typechain/SettingsP0'
import { StRSRP0 } from '../../../typechain/StRSRP0'
import { StaticATokenMock } from '../../../typechain/StaticATokenMock'
import { USDCMock } from '../../../typechain/USDCMock'
import { getLatestBlockTimestamp } from '../../utils/time'

export type Collateral = CollateralP0 | CTokenFiatCollateralP0 | ATokenFiatCollateralP0

const maxAuctionSize = fp(1e6) // $1M

export interface IConfig {
  rewardStart: BigNumber
  rewardPeriod: BigNumber
  auctionPeriod: BigNumber
  stRSRPayPeriod: BigNumber
  stRSRWithdrawalDelay: BigNumber
  defaultDelay: BigNumber
  maxTradeSlippage: BigNumber
  dustAmount: BigNumber
  backingBuffer: BigNumber
  issuanceRate: BigNumber
  defaultThreshold: BigNumber
  stRSRPayRatio: BigNumber
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
  compoundOracleInternal: CompoundOracleMockP0
  compoundMock: ComptrollerMockP0
  aaveToken: ERC20Mock
  aaveOracleInternal: AaveOracleMockP0
  aaveMock: AaveLendingPoolMockP0
}

async function compAaveFixture(): Promise<COMPAAVEFixture> {
  // Deploy COMP token and Asset
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')

  // Deploy AAVE token and Asset
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')

  // Deploy Comp and Aave Oracle Mocks
  const CompoundOracleMockFactory: ContractFactory = await ethers.getContractFactory(
    'CompoundOracleMockP0'
  )
  const compoundOracleInternal: CompoundOracleMockP0 = <CompoundOracleMockP0>(
    await CompoundOracleMockFactory.deploy()
  )

  const ComptrollerMockFactory: ContractFactory = await ethers.getContractFactory(
    'ComptrollerMockP0'
  )
  const compoundMock: ComptrollerMockP0 = <ComptrollerMockP0>(
    await ComptrollerMockFactory.deploy(compoundOracleInternal.address)
  )
  await compoundMock.setCompToken(compToken.address)

  const AaveOracleMockFactory: ContractFactory = await ethers.getContractFactory('AaveOracleMockP0')
  const weth: ERC20Mock = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')
  const aaveOracleInternal: AaveOracleMockP0 = <AaveOracleMockP0>(
    await AaveOracleMockFactory.deploy(weth.address)
  )

  const AaveAddrProviderFactory: ContractFactory = await ethers.getContractFactory(
    'AaveLendingAddrProviderMockP0'
  )
  const aaveAddrProvider: AaveLendingAddrProviderMockP0 = <AaveLendingAddrProviderMockP0>(
    await AaveAddrProviderFactory.deploy(aaveOracleInternal.address)
  )

  const AaveLendingPoolMockFactory: ContractFactory = await ethers.getContractFactory(
    'AaveLendingPoolMockP0'
  )
  const aaveMock: AaveLendingPoolMockP0 = <AaveLendingPoolMockP0>(
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
  market: MarketMock
}

async function marketFixture(): Promise<ModuleFixture> {
  const MarketMockFactory: ContractFactory = await ethers.getContractFactory('MarketMock')
  const marketMock: MarketMock = <MarketMock>await MarketMockFactory.deploy()
  return { market: marketMock }
}

interface CollateralFixture {
  erc20s: ERC20Mock[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketsNeededAmts: BigNumber[] // reference amounts
}

async function collateralFixture(
  deployer: DeployerP0,
  main: MainP0,
  comptroller: ComptrollerMockP0,
  aaveLendingPool: AaveLendingPoolMockP0,
  aaveToken: ERC20Mock
): Promise<CollateralFixture> {
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const USDC: ContractFactory = await ethers.getContractFactory('USDCMock')
  const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
  const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
  const AaveCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'AavePricedFiatCollateralP0'
  )
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateralP0')
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateralP0')
  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (symbol: string): Promise<[ERC20Mock, CollateralP0]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ERC20.deploy(symbol + ' Token', symbol)
    return [
      erc20,
      <CollateralP0>(
        await AaveCollateralFactory.deploy(
          erc20.address,
          maxAuctionSize,
          main.address,
          comptroller.address,
          aaveLendingPool.address
        )
      ),
    ]
  }
  const makeSixDecimalCollateral = async (symbol: string): Promise<[USDCMock, CollateralP0]> => {
    const erc20: USDCMock = <USDCMock>await USDC.deploy(symbol + ' Token', symbol)
    return [
      erc20,
      <CollateralP0>(
        await AaveCollateralFactory.deploy(
          erc20.address,
          maxAuctionSize,
          main.address,
          comptroller.address,
          aaveLendingPool.address
        )
      ),
    ]
  }
  const makeCTokenCollateral = async (
    symbol: string,
    underlyingAddress: string
  ): Promise<[CTokenMock, CTokenFiatCollateralP0]> => {
    const erc20: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
    )
    const compoundClaimer = await deployer.compoundClaimer()
    return [
      erc20,
      <CTokenFiatCollateralP0>(
        await CTokenCollateralFactory.deploy(
          erc20.address,
          maxAuctionSize,
          underlyingAddress,
          main.address,
          comptroller.address,
          compoundClaimer
        )
      ),
    ]
  }
  const makeATokenCollateral = async (
    symbol: string,
    underlyingAddress: string
  ): Promise<[StaticATokenMock, ATokenFiatCollateralP0]> => {
    const erc20: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
    )

    // Set reward token
    await erc20.setAaveToken(aaveToken.address)

    const aaveClaimer = await deployer.aaveClaimer()

    return [
      erc20,
      <ATokenFiatCollateralP0>(
        await ATokenCollateralFactory.deploy(
          erc20.address,
          maxAuctionSize,
          underlyingAddress,
          main.address,
          comptroller.address,
          aaveLendingPool.address,
          aaveClaimer
        )
      ),
    ]
  }

  // Create all possible collateral
  const dai = await makeVanillaCollateral('DAI')
  const usdc = await makeSixDecimalCollateral('USDC')
  const usdt = await makeVanillaCollateral('USDT')
  const busd = await makeVanillaCollateral('BUSD')
  const cdai = await makeCTokenCollateral('cDAI', dai[0].address)
  const cusdc = await makeCTokenCollateral('cUSDC', usdc[0].address)
  const cusdt = await makeCTokenCollateral('cUSDT', usdt[0].address)
  const adai = await makeATokenCollateral('aDAI', dai[0].address)
  const ausdc = await makeATokenCollateral('aUSDC', usdc[0].address)
  const ausdt = await makeATokenCollateral('aUSDT', usdt[0].address)
  const abusd = await makeATokenCollateral('aBUSD', busd[0].address)
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
  deployer: DeployerP0
  main: MainP0
  assetRegistry: AssetRegistryP0
  auctioneer: AuctioneerP0
  basketHandler: BasketHandlerP0
  rTokenIssuer: RTokenIssuerP0
  revenueDistributor: RevenueDistributorP0
  rewardClaimer: RewardClaimerP0
  settings: SettingsP0
  rsrAsset: AssetP0
  compAsset: AssetP0
  aaveAsset: AssetP0
  rToken: RTokenP0
  rTokenAsset: RTokenAssetP0
  furnace: FurnaceP0
  stRSR: StRSRP0
  facade: ExplorerFacadeP0
  compoundClaimer: CompoundClaimAdapterP0
  aaveClaimer: AaveClaimAdapterP0
  rsrTrader: RevenueTraderP0
  rTokenTrader: RevenueTraderP0
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
  const { market } = await marketFixture()

  // Setup Config
  const rewardStart: BigNumber = bn(await getLatestBlockTimestamp())
  const config: IConfig = {
    rewardStart: rewardStart,
    rewardPeriod: bn('604800'), // 1 week
    auctionPeriod: bn('1800'), // 30 minutes
    stRSRPayPeriod: bn('86400'), // 1 day
    stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
    defaultDelay: bn('86400'), // 24 hs
    maxTradeSlippage: fp('0.01'), // 1%
    dustAmount: fp('0.01'), // 0.01 UoA (USD)
    backingBuffer: fp('0.0001'), // 0.01%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    defaultThreshold: fp('0.05'), // 5% deviation
    stRSRPayRatio: fp('0.02284'), // approx. half life of 30 pay periods
  }

  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0')
  const deployer: DeployerP0 = <DeployerP0>(
    await DeployerFactory.deploy(
      rsr.address,
      compToken.address,
      aaveToken.address,
      market.address,
      compoundMock.address,
      aaveMock.address
    )
  )

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy('RTKN RToken', 'RTKN', owner.address, config, dist, maxAuctionSize)
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
  const facadeAddr = expectInReceipt(receipt, 'RTokenCreated').args.facade
  const main: MainP0 = <MainP0>await ethers.getContractAt('MainP0', mainAddr)

  // Get Components
  const assetRegistry: AssetRegistryP0 = <AssetRegistryP0>(
    await ethers.getContractAt('AssetRegistryP0', await main.assetRegistry())
  )
  const auctioneer: AuctioneerP0 = <AuctioneerP0>(
    await ethers.getContractAt('AuctioneerP0', await main.auctioneer())
  )
  const basketHandler: BasketHandlerP0 = <BasketHandlerP0>(
    await ethers.getContractAt('BasketHandlerP0', await main.basketHandler())
  )
  const rTokenIssuer: RTokenIssuerP0 = <RTokenIssuerP0>(
    await ethers.getContractAt('RTokenIssuerP0', await main.rTokenIssuer())
  )
  const revenueDistributor: RevenueDistributorP0 = <RevenueDistributorP0>(
    await ethers.getContractAt('RevenueDistributorP0', await main.revenueDistributor())
  )
  const rewardClaimer: RewardClaimerP0 = <RewardClaimerP0>(
    await ethers.getContractAt('RewardClaimerP0', await main.rewardClaimer())
  )
  const settings: SettingsP0 = <SettingsP0>(
    await ethers.getContractAt('SettingsP0', await main.settings())
  )

  const compoundClaimer = <CompoundClaimAdapterP0>(
    await ethers.getContractAt('CompoundClaimAdapterP0', await deployer.compoundClaimer())
  )
  const aaveClaimer = <AaveClaimAdapterP0>(
    await ethers.getContractAt('AaveClaimAdapterP0', await deployer.aaveClaimer())
  )

  const rsrAsset: AssetP0 = <AssetP0>(
    await ethers.getContractAt('AavePricedAssetP0', await assetRegistry.toAsset(rsr.address))
  )

  const aaveAsset: AssetP0 = <AssetP0>(
    await ethers.getContractAt('AavePricedAssetP0', await assetRegistry.toAsset(aaveToken.address))
  )
  const compAsset: AssetP0 = <AssetP0>(
    await ethers.getContractAt(
      'CompoundPricedAssetP0',
      await assetRegistry.toAsset(compToken.address)
    )
  )
  const rToken: RTokenP0 = <RTokenP0>await ethers.getContractAt('RTokenP0', await main.rToken())
  const rTokenAsset: RTokenAssetP0 = <RTokenAssetP0>(
    await ethers.getContractAt('RTokenAssetP0', await assetRegistry.toAsset(rToken.address))
  )

  const furnace: FurnaceP0 = <FurnaceP0>(
    await ethers.getContractAt('FurnaceP0', await main.revenueFurnace())
  )
  const stRSR: StRSRP0 = <StRSRP0>await ethers.getContractAt('StRSRP0', await main.stRSR())

  const facade: ExplorerFacadeP0 = <ExplorerFacadeP0>(
    await ethers.getContractAt('ExplorerFacadeP0', facadeAddr)
  )

  // Deploy collateral for Main
  const { erc20s, collateral, basket, basketsNeededAmts } = await collateralFixture(
    deployer,
    main,
    compoundMock,
    aaveMock,
    aaveToken
  )

  const rsrTrader = <RevenueTraderP0>(
    await ethers.getContractAt('RevenueTraderP0', await auctioneer.rsrTrader())
  )
  const rTokenTrader = <RevenueTraderP0>(
    await ethers.getContractAt('RevenueTraderP0', await auctioneer.rTokenTrader())
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
    await assetRegistry.connect(owner).registerAsset(basket[i].address)
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
    auctioneer,
    basketHandler,
    rTokenIssuer,
    revenueDistributor,
    rewardClaimer,
    settings,
    rToken,
    rTokenAsset,
    furnace,
    stRSR,
    market,
    facade,
    compoundClaimer,
    aaveClaimer,
    rsrTrader,
    rTokenTrader,
  }
}
