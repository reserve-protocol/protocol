import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { bn, fp } from '../../../common/numbers'
import { expectInReceipt } from '../../../common/events'
import { getLatestBlockTimestamp } from '../../utils/time'
import { ERC20Mock } from '../../../typechain/ERC20Mock'
import { AssetP0 } from '../../../typechain/AssetP0'
import { RSRAssetP0 } from '../../../typechain/RSRAssetP0'
import { COMPAssetP0 } from '../../../typechain/COMPAssetP0'
import { ComptrollerMockP0 } from '../../../typechain/ComptrollerMockP0'
import { CompoundOracleMockP0 } from '../../../typechain/CompoundOracleMockP0'
import { AAVEAssetP0 } from '../../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../../typechain/AaveLendingPoolMockP0'
import { AaveLendingAddrProviderMockP0 } from '../../../typechain/AaveLendingAddrProviderMockP0'
import { AaveOracleMockP0 } from '../../../typechain/AaveOracleMockP0'
import { DeployerP0 } from '../../../typechain/DeployerP0'
import { MainP0 } from '../../../typechain/MainP0'
import { VaultP0 } from '../../../typechain/VaultP0'
import { RTokenP0 } from '../../../typechain/RTokenP0'
import { FurnaceP0 } from '../../../typechain/FurnaceP0'
import { StRSRP0 } from '../../../typechain/StRSRP0'
import { AssetManagerP0 } from '../../../typechain/AssetManagerP0'
import { DefaultMonitorP0 } from '../../../typechain/DefaultMonitorP0'

import { Fixture } from 'ethereum-waffle'

export interface IManagerConfig {
  rewardStart: BigNumber
  rewardPeriod: BigNumber
  auctionPeriod: BigNumber
  stRSRWithdrawalDelay: BigNumber
  defaultDelay: BigNumber
  maxTradeSlippage: BigNumber
  auctionClearingTolerance: BigNumber
  maxAuctionSize: BigNumber
  minRecapitalizationAuctionSize: BigNumber
  minRevenueAuctionSize: BigNumber
  migrationChunk: BigNumber
  issuanceRate: BigNumber
  defaultThreshold: BigNumber
  f: BigNumber
}

export interface IParamsAssets {
  rsrAsset: string
  compAsset: string
  aaveAsset: string
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
  compAsset: COMPAssetP0
  aaveAsset: AAVEAssetP0
  compoundMock: ComptrollerMockP0
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
  const CompoundOracleMockFactory: ContractFactory = await ethers.getContractFactory('CompoundOracleMockP0')
  const compoundOracle: CompoundOracleMockP0 = <CompoundOracleMockP0>await CompoundOracleMockFactory.deploy()

  const ComptrollerMockFactory: ContractFactory = await ethers.getContractFactory('ComptrollerMockP0')
  const compoundMock: ComptrollerMockP0 = <ComptrollerMockP0>await ComptrollerMockFactory.deploy(compoundOracle.address)

  const AaveOracleMockFactory: ContractFactory = await ethers.getContractFactory('AaveOracleMockP0')
  const weth: ERC20Mock = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')
  const aaveOracle: AaveOracleMockP0 = <AaveOracleMockP0>await AaveOracleMockFactory.deploy(weth.address)

  const AaveAddrProviderFactory: ContractFactory = await ethers.getContractFactory('AaveLendingAddrProviderMockP0')
  const aaveAddrProvider: AaveLendingAddrProviderMockP0 = <AaveLendingAddrProviderMockP0>(
    await AaveAddrProviderFactory.deploy(aaveOracle.address)
  )

  const AaveLendingPoolMockFactory: ContractFactory = await ethers.getContractFactory('AaveLendingPoolMockP0')
  const aaveMock: AaveLendingPoolMockP0 = <AaveLendingPoolMockP0>(
    await AaveLendingPoolMockFactory.deploy(aaveAddrProvider.address)
  )

  return { compAsset, aaveAsset, compoundMock, aaveMock }
}

interface VaultFixture {
  assets: string[]
  vault: VaultP0
}

async function vaultFixture(): Promise<VaultFixture> {
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')

  // Deploy Main Vault
  const token0: ERC20Mock = <ERC20Mock>await ERC20.deploy('Token 0', 'TKN0')
  const token1: ERC20Mock = <ERC20Mock>await ERC20.deploy('Token 1', 'TKN1')
  const token2: ERC20Mock = <ERC20Mock>await ERC20.deploy('Token 2', 'TKN2')
  const token3: ERC20Mock = <ERC20Mock>await ERC20.deploy('Token 3', 'TKN2')

  // Set initial amounts and set quantities
  const qtyHalf: BigNumber = bn('1e18').div(2)
  const qtyThird: BigNumber = bn('1e18').div(3)
  const qtyDouble: BigNumber = bn('1e18').mul(2)

  // Set Collateral Assets and Quantities
  const AssetFactory: ContractFactory = await ethers.getContractFactory('AssetP0')
  const asset0: AssetP0 = <AssetP0>await AssetFactory.deploy(token0.address, token0.decimals())
  const asset1: AssetP0 = <AssetP0>await AssetFactory.deploy(token1.address, token1.decimals())
  const asset2: AssetP0 = <AssetP0>await AssetFactory.deploy(token2.address, token2.decimals())
  const asset3: AssetP0 = <AssetP0>await AssetFactory.deploy(token3.address, token3.decimals())

  const assets: string[] = [asset0.address, asset1.address, asset2.address, asset3.address]
  const quantities: BigNumber[] = [qtyHalf, qtyHalf, qtyThird, qtyDouble]

  const VaultFactory: ContractFactory = await ethers.getContractFactory('VaultP0')
  const vault: VaultP0 = <VaultP0>await VaultFactory.deploy(assets, quantities, [])

  return { assets, vault }
}

type RSRAndCompAaveAndVaultFixture = RSRFixture & COMPAAVEFixture & VaultFixture

interface DeployerFixture extends RSRAndCompAaveAndVaultFixture {
  config: IManagerConfig
  deployer: DeployerP0
  main: MainP0
  rToken: RTokenP0
  furnace: FurnaceP0
  stRSR: StRSRP0
  assetManager: AssetManagerP0
  defaultMonitor: DefaultMonitorP0
}

export const deployerFixture: Fixture<DeployerFixture> = async function ([owner]): Promise<DeployerFixture> {
  const { rsr, rsrAsset } = await rsrFixture()
  const { compAsset, aaveAsset, compoundMock, aaveMock } = await compAaveFixture()
  const { assets, vault } = await vaultFixture()

  const paramsAssets: IParamsAssets = {
    rsrAsset: rsrAsset.address,
    compAsset: compAsset.address,
    aaveAsset: aaveAsset.address,
  }

  // Setup Config
  const rewardStart: BigNumber = bn(await getLatestBlockTimestamp())
  const config: IManagerConfig = {
    rewardStart: rewardStart,
    rewardPeriod: bn('604800'), // 1 week
    auctionPeriod: bn('1800'), // 30 minutes
    stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
    defaultDelay: bn('86400'), // 24 hs
    auctionClearingTolerance: fp('0.05'), // 5%
    maxTradeSlippage: fp('0.05'), // 5%
    maxAuctionSize: fp('0.01'), // 1%
    minRecapitalizationAuctionSize: fp('0.001'), // 0.1%
    minRevenueAuctionSize: fp('0.0001'), // 0.01%
    migrationChunk: fp('0.2'), // 20%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    defaultThreshold: fp('0.05'), // 5% deviation
    f: fp('0.60'), // 60% to stakers
  }

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0')
  const deployer: DeployerP0 = <DeployerP0>await DeployerFactory.deploy()

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy(
      'RToken',
      'RTKN',
      owner.address,
      vault.address,
      rsr.address,
      config,
      compoundMock.address,
      aaveMock.address,
      paramsAssets,
      assets
    )
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main

  // Get Components
  const main: MainP0 = <MainP0>await ethers.getContractAt('MainP0', mainAddr)
  const rToken: RTokenP0 = <RTokenP0>await ethers.getContractAt('RTokenP0', await main.rToken())
  const furnace: FurnaceP0 = <FurnaceP0>await ethers.getContractAt('FurnaceP0', await main.furnace())
  const stRSR: StRSRP0 = <StRSRP0>await ethers.getContractAt('StRSRP0', await main.stRSR())
  const assetManager: AssetManagerP0 = <AssetManagerP0>(
    await ethers.getContractAt('AssetManagerP0', await main.manager())
  )
  const defaultMonitor: DefaultMonitorP0 = <DefaultMonitorP0>(
    await ethers.getContractAt('DefaultMonitorP0', await main.monitor())
  )

  return {
    rsr,
    rsrAsset,
    compAsset,
    aaveAsset,
    compoundMock,
    aaveMock,
    assets,
    vault,
    config,
    deployer,
    main,
    rToken,
    furnace,
    stRSR,
    assetManager,
    defaultMonitor,
  }
}
