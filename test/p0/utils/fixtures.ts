import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { expectInReceipt } from '../../../common/events'
import { bn, fp } from '../../../common/numbers'
import { AaveLendingAddrProviderMockP0 } from '../../../typechain/AaveLendingAddrProviderMockP0'
import { AaveLendingPoolMockP0 } from '../../../typechain/AaveLendingPoolMockP0'
import { AaveOracle } from '../../../typechain/AaveOracle'
import { AaveOracleMockP0 } from '../../../typechain/AaveOracleMockP0'
import { AssetP0 } from '../../../typechain/AssetP0'
import { ATokenCollateralP0 } from '../../../typechain/ATokenCollateralP0'
import { CollateralP0 } from '../../../typechain/CollateralP0'
import { CompoundOracle } from '../../../typechain/CompoundOracle'
import { CompoundOracleMockP0 } from '../../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../../typechain/CTokenMock'
import { DeployerP0 } from '../../../typechain/DeployerP0'
import { ERC20Mock } from '../../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../../typechain/FurnaceP0'
import { MainP0 } from '../../../typechain/MainP0'
import { MarketMock } from '../../../typechain/MarketMock'
import { RTokenAssetP0 } from '../../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../../typechain/RTokenP0'
import { StaticATokenMock } from '../../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../../typechain/StRSRP0'
import { USDCMock } from '../../../typechain/USDCMock'
import { getLatestBlockTimestamp } from '../../utils/time'

export type Collateral = CollateralP0 | CTokenCollateralP0 | ATokenCollateralP0

export interface IConfig {
  rewardStart: BigNumber
  rewardPeriod: BigNumber
  auctionPeriod: BigNumber
  stRSRWithdrawalDelay: BigNumber
  defaultDelay: BigNumber
  maxTradeSlippage: BigNumber
  maxAuctionSize: BigNumber
  minRecapitalizationAuctionSize: BigNumber
  minRevenueAuctionSize: BigNumber
  migrationChunk: BigNumber
  issuanceRate: BigNumber
  defaultThreshold: BigNumber
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
  compoundOracle: CompoundOracle
  aaveToken: ERC20Mock
  aaveOracleInternal: AaveOracleMockP0
  aaveMock: AaveLendingPoolMockP0
  aaveOracle: AaveOracle
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

  const CompoundOracleFactory: ContractFactory = await ethers.getContractFactory('CompoundOracle')
  const compoundOracle: CompoundOracle = <CompoundOracle>(
    await CompoundOracleFactory.deploy(compoundMock.address)
  )

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

  const AaveOracleFactory: ContractFactory = await ethers.getContractFactory('AaveOracle')
  const aaveOracle: AaveOracle = <AaveOracle>(
    await AaveOracleFactory.deploy(compoundMock.address, aaveMock.address)
  )

  return {
    weth,
    compToken,
    compoundOracleInternal,
    compoundMock,
    compoundOracle,
    aaveToken,
    aaveOracleInternal,
    aaveMock,
    aaveOracle,
  }
}

interface MarketFixture {
  market: MarketMock
}

async function marketFixture(): Promise<MarketFixture> {
  const MarketMockFactory: ContractFactory = await ethers.getContractFactory('MarketMock')
  const marketMock: MarketMock = <MarketMock>await MarketMockFactory.deploy()
  return { market: marketMock }
}

interface CollateralFixture {
  erc20s: ERC20Mock[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketReferenceAmounts: BigNumber[] // reference amounts
}

async function collateralFixture(
  main: MainP0,
  compoundOracle: CompoundOracle,
  aaveOracle: AaveOracle
): Promise<CollateralFixture> {
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const USDC: ContractFactory = await ethers.getContractFactory('USDCMock')
  const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
  const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
  const CollateralFactory: ContractFactory = await ethers.getContractFactory('CollateralP0')
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenCollateralP0')
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenCollateralP0')

  // Deploy all potential collateral assets
  const makeVanilla = async (symbol: string): Promise<[ERC20Mock, CollateralP0]> => {
    const erc20: ERC20Mock = <ERC20Mock>await ERC20.deploy(symbol + ' Token', symbol)
    return [
      erc20,
      <CollateralP0>(
        await CollateralFactory.deploy(
          erc20.address,
          erc20.address,
          main.address,
          aaveOracle.address,
          ethers.utils.formatBytes32String(symbol),
          fp('1')
        )
      ),
    ]
  }
  const makeSixDecimal = async (symbol: string): Promise<[USDCMock, CollateralP0]> => {
    const erc20: USDCMock = <USDCMock>await USDC.deploy(symbol + ' Token', symbol)
    return [
      erc20,
      <CollateralP0>(
        await CollateralFactory.deploy(
          erc20.address,
          erc20.address,
          main.address,
          aaveOracle.address,
          ethers.utils.formatBytes32String(symbol),
          fp('1')
        )
      ),
    ]
  }
  const makeCToken = async (
    symbol: string,
    underlyingAddress: string,
    underlyingDecimals: number
  ): Promise<[CTokenMock, CTokenCollateralP0]> => {
    const erc20: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
    )
    return [
      erc20,
      <CTokenCollateralP0>(
        await CTokenCollateralFactory.deploy(
          erc20.address,
          underlyingAddress,
          main.address,
          compoundOracle.address,
          ethers.utils.formatBytes32String(symbol),
          fp('1')
        )
      ),
    ]
  }
  const makeAToken = async (
    symbol: string,
    underlyingAddress: string
  ): Promise<[StaticATokenMock, ATokenCollateralP0]> => {
    const erc20: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
    )
    return [
      erc20,
      <ATokenCollateralP0>(
        await ATokenCollateralFactory.deploy(
          erc20.address,
          underlyingAddress,
          main.address,
          aaveOracle.address,
          ethers.utils.formatBytes32String(symbol),
          fp('1')
        )
      ),
    ]
  }

  // Create all possible collateral
  const dai = await makeVanilla('DAI')
  const usdc = await makeSixDecimal('USDC')
  const usdt = await makeVanilla('USDT')
  const busd = await makeVanilla('BUSD')
  const cdai = await makeCToken('cDAI', dai[0].address, await dai[0].decimals())
  const cusdc = await makeCToken('cUSDC', usdc[0].address, await usdc[0].decimals())
  const cusdt = await makeCToken('cUSDT', usdt[0].address, await usdt[0].decimals())
  const adai = await makeAToken('aDAI', dai[0].address)
  const ausdc = await makeAToken('aUSDC', usdc[0].address)
  const ausdt = await makeAToken('aUSDT', usdt[0].address)
  const abusd = await makeAToken('aBUSD', busd[0].address)
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
  const basketReferenceAmounts = [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]

  return {
    erc20s,
    collateral,
    basket,
    basketReferenceAmounts,
  }
}

type RSRAndCompAaveAndCollateralAndMarketFixture = RSRFixture &
  COMPAAVEFixture &
  CollateralFixture &
  MarketFixture

interface DefaultFixture extends RSRAndCompAaveAndCollateralAndMarketFixture {
  config: IConfig
  dist: IRevenueShare
  deployer: DeployerP0
  main: MainP0
  rsrAsset: AssetP0
  compAsset: AssetP0
  aaveAsset: AssetP0
  rToken: RTokenP0
  rTokenAsset: RTokenAssetP0
  furnace: FurnaceP0
  stRSR: StRSRP0
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
    compoundOracle,
    aaveToken,
    aaveOracleInternal,
    aaveMock,
    aaveOracle,
  } = await compAaveFixture()
  const { market } = await marketFixture()

  // Setup Config
  const rewardStart: BigNumber = bn(await getLatestBlockTimestamp())
  const config: IConfig = {
    rewardStart: rewardStart,
    rewardPeriod: bn('604800'), // 1 week
    auctionPeriod: bn('1800'), // 30 minutes
    stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
    defaultDelay: bn('86400'), // 24 hs
    maxTradeSlippage: fp('0.01'), // 1%
    maxAuctionSize: fp('0.01'), // 1%
    minRecapitalizationAuctionSize: fp('0.001'), // 0.1%
    minRevenueAuctionSize: fp('0.0001'), // 0.01%
    migrationChunk: fp('0.2'), // 20%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    defaultThreshold: fp('0.05'), // 5% deviation
  }

  const dist: IRevenueShare = {
    rTokenDist: fp('0.4'), // 40% RToken
    rsrDist: fp('0.6'), // 60% RSR
  }

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0')
  const deployer: DeployerP0 = <DeployerP0>(
    await DeployerFactory.deploy(
      rsr.address,
      compToken.address,
      aaveToken.address,
      market.address,
      compoundOracle.address,
      aaveOracle.address
    )
  )

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy(
      'RTKN RToken',
      'RTKN',
      owner.address,
      config,
      dist
      //collateral.map((c) => c.address)
    )
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main

  // Get Components
  const main: MainP0 = <MainP0>await ethers.getContractAt('MainP0', mainAddr)
  const rsrAsset: AssetP0 = <AssetP0>await ethers.getContractAt('AssetP0', await main.rsrAsset())
  const compAsset: AssetP0 = <AssetP0>await ethers.getContractAt('AssetP0', await main.compAsset())
  const aaveAsset: AssetP0 = <AssetP0>await ethers.getContractAt('AssetP0', await main.aaveAsset())
  const rToken: RTokenP0 = <RTokenP0>await ethers.getContractAt('RTokenP0', await main.rToken())
  const rTokenAsset: RTokenAssetP0 = <RTokenAssetP0>(
    await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
  )

  const furnace: FurnaceP0 = <FurnaceP0>(
    await ethers.getContractAt('FurnaceP0', await main.revenueFurnace())
  )
  const stRSR: StRSRP0 = <StRSRP0>await ethers.getContractAt('StRSRP0', await main.stRSR())

  // Deploy collateral for Main
  const { erc20s, collateral, basket, basketReferenceAmounts } = await collateralFixture(
    main,
    compoundOracle,
    aaveOracle
  )

  // Set Oracle Prices
  await compoundOracleInternal.setPrice('ETH', bn('4000e6'))
  await compoundOracleInternal.setPrice('COMP', bn('1e6'))
  await aaveOracleInternal.setPrice(weth.address, bn('1e18'))
  await aaveOracleInternal.setPrice(aaveToken.address, bn('2.5e14'))
  await aaveOracleInternal.setPrice(compToken.address, bn('2.5e14'))
  await aaveOracleInternal.setPrice(rsr.address, bn('2.5e14'))
  for (let i = 0; i < collateral.length; i++) {
    const erc20 = await ethers.getContractAt('ERC20Mock', await collateral[i].erc20())
    await compoundOracleInternal.setPrice(await erc20.symbol(), bn('1e6'))
    await aaveOracleInternal.setPrice(erc20.address, bn('2.5e14'))

    // Add approved Collateral
    await main.connect(owner).addAsset(collateral[i].address)
  }

  // Set non-empty basket
  await main.connect(owner).setBasket(
    basket.map((b) => b.address),
    basketReferenceAmounts
  )

  // Unpause
  await main.connect(owner).unpause()

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundOracleInternal,
    compoundOracle,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracleInternal,
    aaveOracle,
    aaveMock,
    erc20s,
    collateral,
    basket,
    basketReferenceAmounts,
    config,
    dist,
    deployer,
    main,
    rToken,
    rTokenAsset,
    furnace,
    stRSR,
    market,
  }
}
