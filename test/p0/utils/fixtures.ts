import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { expectInReceipt } from '../../../common/events'
import { bn, fp } from '../../../common/numbers'
import { AAVEAssetP0 } from '../../../typechain/AAVEAssetP0'
import { AaveLendingAddrProviderMockP0 } from '../../../typechain/AaveLendingAddrProviderMockP0'
import { AaveLendingPoolMockP0 } from '../../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../../typechain/AaveOracleMockP0'
import { ATokenCollateralP0 } from '../../../typechain/ATokenCollateralP0'
import { CollateralP0 } from '../../../typechain/CollateralP0'
import { COMPAssetP0 } from '../../../typechain/COMPAssetP0'
import { CompoundOracleMockP0 } from '../../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../../typechain/CTokenMock'
import { DeployerP0 } from '../../../typechain/DeployerP0'
import { ERC20Mock } from '../../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../../typechain/FurnaceP0'
import { MainP0 } from '../../../typechain/MainP0'
import { MarketMock } from '../../../typechain/MarketMock'
import { RSRAssetP0 } from '../../../typechain/RSRAssetP0'
import { RTokenP0 } from '../../../typechain/RTokenP0'
import { StaticATokenMock } from '../../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../../typechain/StRSRP0'
import { USDCMock } from '../../../typechain/USDCMock'
import { VaultP0 } from '../../../typechain/VaultP0'
import { getLatestBlockTimestamp } from '../../utils/time'

export enum State {
  CALM = 0,
  DOUBT = 1,
  TRADING = 2,
}

export interface IManagerConfig {
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
  rsrAsset: RSRAssetP0
}

async function rsrFixture(): Promise<RSRFixture> {
  // Deploy RSR and asset
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const rsr: ERC20Mock = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')

  const RSRAssetFactory: ContractFactory = await ethers.getContractFactory('RSRAssetP0')
  const rsrAsset: RSRAssetP0 = <RSRAssetP0>await RSRAssetFactory.deploy(rsr.address)

  return { rsr, rsrAsset }
}

interface COMPAAVEFixture {
  weth: ERC20Mock
  compToken: ERC20Mock
  compAsset: COMPAssetP0
  compoundOracle: CompoundOracleMockP0
  compoundMock: ComptrollerMockP0
  aaveToken: ERC20Mock
  aaveAsset: AAVEAssetP0
  aaveOracle: AaveOracleMockP0
  aaveMock: AaveLendingPoolMockP0
}

async function compAaveFixture(): Promise<COMPAAVEFixture> {
  // Deploy COMP token and Asset
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')
  const COMPAssetFactory: ContractFactory = await ethers.getContractFactory('COMPAssetP0')
  const compAsset: COMPAssetP0 = <COMPAssetP0>await COMPAssetFactory.deploy(compToken.address)

  // Deploy AAVE token and Asset
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')
  const AAVEAssetFactory: ContractFactory = await ethers.getContractFactory('AAVEAssetP0')
  const aaveAsset: AAVEAssetP0 = <AAVEAssetP0>await AAVEAssetFactory.deploy(aaveToken.address)

  // Deploy Comp and Aave Oracle Mocks
  const CompoundOracleMockFactory: ContractFactory = await ethers.getContractFactory(
    'CompoundOracleMockP0'
  )
  const compoundOracle: CompoundOracleMockP0 = <CompoundOracleMockP0>(
    await CompoundOracleMockFactory.deploy()
  )

  const ComptrollerMockFactory: ContractFactory = await ethers.getContractFactory(
    'ComptrollerMockP0'
  )
  const compoundMock: ComptrollerMockP0 = <ComptrollerMockP0>(
    await ComptrollerMockFactory.deploy(compoundOracle.address)
  )
  await compoundMock.setCompToken(compToken.address)

  const AaveOracleMockFactory: ContractFactory = await ethers.getContractFactory('AaveOracleMockP0')
  const weth: ERC20Mock = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')
  const aaveOracle: AaveOracleMockP0 = <AaveOracleMockP0>(
    await AaveOracleMockFactory.deploy(weth.address)
  )

  const AaveAddrProviderFactory: ContractFactory = await ethers.getContractFactory(
    'AaveLendingAddrProviderMockP0'
  )
  const aaveAddrProvider: AaveLendingAddrProviderMockP0 = <AaveLendingAddrProviderMockP0>(
    await AaveAddrProviderFactory.deploy(aaveOracle.address)
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
    compAsset,
    compoundOracle,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracle,
    aaveMock,
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

interface VaultFixture {
  token0: ERC20Mock
  token1: USDCMock
  token2: StaticATokenMock
  token3: CTokenMock
  collateral0: CollateralP0
  collateral1: CollateralP0
  collateral2: ATokenCollateralP0
  collateral3: CTokenCollateralP0
  collateral: string[]
  vault: VaultP0
}

async function vaultFixture(): Promise<VaultFixture> {
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const USDC: ContractFactory = await ethers.getContractFactory('USDCMock')
  const ATokenMockFactory: ContractFactory = await ethers.getContractFactory('StaticATokenMock')
  const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')

  // Deploy Main Vault
  const token0: ERC20Mock = <ERC20Mock>await ERC20.deploy('Token', 'TKN')
  const token1: USDCMock = <USDCMock>await USDC.deploy('USDC Token', 'USDCTKN')
  const token2: StaticATokenMock = <StaticATokenMock>(
    await ATokenMockFactory.deploy('AToken', 'ATKN', token0.address)
  )
  const token3: CTokenMock = <CTokenMock>(
    await CTokenMockFactory.deploy('CToken', 'CTKN', token0.address)
  )

  // Set initial amounts and set quantities
  const qtyOne: BigNumber = bn('1e18')
  const qtyHalf: BigNumber = qtyOne.div(2)

  // Set Collateral Assets and Quantities
  const AssetFactory: ContractFactory = await ethers.getContractFactory('CollateralP0')
  const ATokenAssetFactory = await ethers.getContractFactory('ATokenCollateralP0')
  const CTokenAssetFactory = await ethers.getContractFactory('CTokenCollateralP0')

  const collateral0: CollateralP0 = <CollateralP0>(
    await AssetFactory.deploy(token0.address, token0.decimals())
  )
  const collateral1: CollateralP0 = <CollateralP0>(
    await AssetFactory.deploy(token1.address, token1.decimals())
  )
  const collateral2: ATokenCollateralP0 = <ATokenCollateralP0>(
    await ATokenAssetFactory.deploy(token2.address)
  )
  const collateral3: CTokenCollateralP0 = <CTokenCollateralP0>(
    await CTokenAssetFactory.deploy(token3.address)
  )

  const collateral: string[] = [
    collateral0.address,
    collateral1.address,
    collateral2.address,
    collateral3.address,
  ]
  const quantities: BigNumber[] = [qtyHalf, qtyHalf, qtyOne, qtyOne]

  const VaultFactory: ContractFactory = await ethers.getContractFactory('VaultP0')
  const vault: VaultP0 = <VaultP0>await VaultFactory.deploy(collateral, quantities, [])

  return {
    token0,
    token1,
    token2,
    token3,
    collateral0,
    collateral1,
    collateral2,
    collateral3,
    collateral,
    vault,
  }
}

type RSRAndCompAaveAndVaultAndMarketFixture = RSRFixture &
  COMPAAVEFixture &
  VaultFixture &
  MarketFixture

interface DefaultFixture extends RSRAndCompAaveAndVaultAndMarketFixture {
  config: IManagerConfig
  dist: IRevenueShare
  deployer: DeployerP0
  main: MainP0
  rToken: RTokenP0
  furnace: FurnaceP0
  stRSR: StRSRP0
}

export const defaultFixture: Fixture<DefaultFixture> = async function ([
  owner,
]): Promise<DefaultFixture> {
  const { rsr, rsrAsset } = await rsrFixture()
  const {
    token0,
    token1,
    token2,
    token3,
    collateral0,
    collateral1,
    collateral2,
    collateral3,
    collateral,
    vault,
  } = await vaultFixture()
  const {
    weth,
    compToken,
    compAsset,
    compoundOracle,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracle,
    aaveMock,
  } = await compAaveFixture()
  const { market } = await marketFixture()

  // Set Default Oracle Prices
  await compoundOracle.setPrice('TKN', bn('1e6'))
  await compoundOracle.setPrice('USDCTKN', bn('1e6'))
  await compoundOracle.setPrice('ETH', bn('4000e6'))
  await compoundOracle.setPrice('COMP', bn('1e6'))

  await aaveOracle.setPrice(token0.address, bn('2.5e14'))
  await aaveOracle.setPrice(token1.address, bn('2.5e14'))
  await aaveOracle.setPrice(weth.address, bn('1e18'))
  await aaveOracle.setPrice(aaveToken.address, bn('2.5e14'))
  await aaveOracle.setPrice(compToken.address, bn('2.5e14'))
  await aaveOracle.setPrice(rsr.address, bn('2.5e14'))

  // Setup Config
  const rewardStart: BigNumber = bn(await getLatestBlockTimestamp())
  const config: IManagerConfig = {
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
      rsrAsset.address,
      compAsset.address,
      aaveAsset.address,
      market.address
    )
  )

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy(
      'RTKN RToken',
      'RTKN',
      owner.address,
      vault.address,
      config,
      dist,
      compoundMock.address,
      aaveMock.address,
      collateral
    )
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main

  // Get Components
  const main: MainP0 = <MainP0>await ethers.getContractAt('MainP0', mainAddr)
  const rToken: RTokenP0 = <RTokenP0>await ethers.getContractAt('RTokenP0', await main.rToken())
  const furnace: FurnaceP0 = <FurnaceP0>(
    await ethers.getContractAt('FurnaceP0', await main.revenueFurnace())
  )
  const stRSR: StRSRP0 = <StRSRP0>await ethers.getContractAt('StRSRP0', await main.stRSR())

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundOracle,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracle,
    aaveMock,
    token0,
    token1,
    token2,
    token3,
    collateral0,
    collateral1,
    collateral2,
    collateral3,
    collateral,
    vault,
    config,
    dist,
    deployer,
    main,
    rToken,
    furnace,
    stRSR,
    market,
  }
}
