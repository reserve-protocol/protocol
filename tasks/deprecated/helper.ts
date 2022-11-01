import { IConfig, IImplementations } from '../common/configuration'
import { ONE_ETH } from './../common/constants'
import { GnosisMock } from '@typechain/GnosisMock'
import { ContractFactory } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { bn, fp } from '../common/numbers'
import { CTokenMock } from './../typechain/CTokenMock.d'
import { StaticATokenMock } from './../typechain/StaticATokenMock.d'
import { MainP1 } from '@typechain/MainP1'
import { TradingLibP1 } from '@typechain/TradingLibP1'
import { RewardableLibP1 } from '@typechain/RewardableLibP1'
import { AssetRegistryP1 } from '@typechain/AssetRegistryP1'
import { BackingManagerP1 } from '@typechain/BackingManagerP1'
import { BasketHandlerP1 } from '@typechain/BasketHandlerP1'
import { DistributorP1 } from '@typechain/DistributorP1'
import { RevenueTraderP1 } from '@typechain/RevenueTraderP1'
import { FurnaceP1 } from '@typechain/FurnaceP1'
import { GnosisTrade } from '@typechain/GnosisTrade'
import { BrokerP1 } from '@typechain/BrokerP1'
import { RTokenP1 } from '@typechain/RTokenP1'
import { StRSRP1Votes } from '@typechain/StRSRP1Votes'
import { RTokenAsset } from '@typechain/RTokenAsset'
import { ZERO_ADDRESS } from '../common/constants'
import { AavePricedAsset, CompoundPricedAsset, RTokenPricingLib } from './../typechain'
import { CompoundPricedAsset } from '@typechain/CompoundPricedAsset'

export const defaultThreshold = fp('0.05') // 5%
export const delayUntilDefault = bn('86400') // 24h
export const RSR_ADDRESS = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const AAVE_ADDRESS = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
export const COMP_ADDRESS = '0xc00e94cb662c3520282e6f5717214004a7f26888'
export const COMPTROLLER_ADDRESS = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B'
export const AAVE_LENDING_ADDRESS = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9'

// Setup Config
export const config: IConfig = {
  maxTradeVolume: fp('1e6'), // $1M
  dist: {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  },
  rewardPeriod: bn('604800'), // 1 week
  rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
  unstakingDelay: bn('1209600'), // 2 weeks
  tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
  auctionLength: bn('900'), // 15 minutes
  backingBuffer: fp('0.0001'), // 0.01%
  maxTradeSlippage: fp('0.01'), // 1%
  dustAmount: fp('0.01'), // 0.01 UoA (USD)
  issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
  shortFreeze: bn('259200'), // 3 days
  longFreeze: bn('2592000'), // 30 days
}

const createATokenCollateral = async (
  hre: HardhatRuntimeEnvironment,
  symbol: string,
  underlyingAddress: string
): Promise<[string, string]> => {
  const [deployer] = await hre.ethers.getSigners()
  // Factory contracts
  const ATokenMockFactory = await hre.ethers.getContractFactory('StaticATokenMock')
  const ATokenCollateralFactory = await hre.ethers.getContractFactory('ATokenFiatCollateral')

  // Create static token
  const erc20: StaticATokenMock = <StaticATokenMock>(
    await ATokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
  )
  await erc20.deployed()
  await erc20.setAaveToken(AAVE_ADDRESS)

  // Create token collateral
  const collateral = await ATokenCollateralFactory.deploy(
    erc20.address,
    config.rTokenMaxTradeVolume,
    defaultThreshold,
    delayUntilDefault,
    underlyingAddress,
    COMPTROLLER_ADDRESS,
    AAVE_LENDING_ADDRESS, // Aave lending pool
    AAVE_ADDRESS
  )
  await collateral.deployed()
  await erc20.connect(deployer).mint(deployer.address, ONE_ETH.mul(100000000000))

  return [erc20.address, collateral.address]
}

const createCTokenCollateral = async (
  hre: HardhatRuntimeEnvironment,
  symbol: string,
  underlyingAddress: string
): Promise<[string, string]> => {
  // Factory contracts
  const [deployer] = await hre.ethers.getSigners()
  const CTokenMockFactory = await hre.ethers.getContractFactory('CTokenMock')
  const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral')

  // Create static token
  const erc20: CTokenMock = <CTokenMock>(
    await CTokenMockFactory.deploy(symbol + ' Token', symbol, underlyingAddress)
  )
  await erc20.deployed()

  // Create token collateral
  const collateral = await CTokenCollateralFactory.deploy(
    erc20.address,
    config.rTokenMaxTradeVolume,
    defaultThreshold,
    delayUntilDefault,
    underlyingAddress,
    COMPTROLLER_ADDRESS,
    COMP_ADDRESS
  )
  await erc20.deployed()
  await erc20.connect(deployer).mint(deployer.address, ONE_ETH.mul(100000000000))

  return [erc20.address, collateral.address]
}

export const deployMarket = async (hre: HardhatRuntimeEnvironment): Promise<string> => {
  const GnosisMockFactory: ContractFactory = await hre.ethers.getContractFactory('GnosisMock')
  const marketMock: GnosisMock = <GnosisMock>await GnosisMockFactory.deploy()
  await marketMock.deployed()

  return marketMock.address
}

export const deployImplementations = async (
  hre: HardhatRuntimeEnvironment
): Promise<IImplementations> => {
  // Deploy implementations
  const MainImplFactory: ContractFactory = await hre.ethers.getContractFactory('MainP1')
  const mainImpl = <MainP1>await MainImplFactory.deploy()
  await mainImpl.deployed()

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await hre.ethers.getContractFactory('TradingLibP1')
  const tradingLib = <TradingLibP1>await TradingLibFactory.deploy()
  await tradingLib.deployed()

  // Deploy RewardableLib external library
  const RewardableLibFactory: ContractFactory = await hre.ethers.getContractFactory(
    'RewardableLibP1'
  )
  const rewardableLib = <RewardableLibP1>await RewardableLibFactory.deploy()
  await rewardableLib.deployed()

  // Deploy RTokenPricingLib
  const RTokenPricingLibFactory: ContractFactory = await hre.ethers.getContractFactory(
    'RTokenPricingLib'
  )
  const rTokenPricing = <RTokenPricingLib>await RTokenPricingLibFactory.deploy()
  await rTokenPricing.deployed()

  const AssetRegImplFactory: ContractFactory = await hre.ethers.getContractFactory(
    'AssetRegistryP1'
  )
  const assetRegImpl = <AssetRegistryP1>await AssetRegImplFactory.deploy()
  await assetRegImpl.deployed()

  const BackingMgrImplFactory: ContractFactory = await hre.ethers.getContractFactory(
    'BackingManagerP1',
    { libraries: { RewardableLibP1: rewardableLib.address, TradingLibP1: tradingLib.address } }
  )
  const backingMgrImpl = <BackingManagerP1>await BackingMgrImplFactory.deploy()
  await backingMgrImpl.deployed()

  const BskHandlerImplFactory: ContractFactory = await hre.ethers.getContractFactory(
    'BasketHandlerP1'
  )
  const bskHndlrImpl = <BasketHandlerP1>await BskHandlerImplFactory.deploy()
  await bskHndlrImpl.deployed()

  const DistribImplFactory: ContractFactory = await hre.ethers.getContractFactory('DistributorP1')
  const distribImpl = <DistributorP1>await DistribImplFactory.deploy()

  const RevTraderImplFactory: ContractFactory = await hre.ethers.getContractFactory(
    'RevenueTraderP1',
    {
      libraries: { RewardableLibP1: rewardableLib.address, TradingLibP1: tradingLib.address },
    }
  )
  const revTraderImpl = <RevenueTraderP1>await RevTraderImplFactory.deploy()
  await revTraderImpl.deployed()

  const FurnaceImplFactory: ContractFactory = await hre.ethers.getContractFactory('FurnaceP1')
  const furnaceImpl = <FurnaceP1>await FurnaceImplFactory.deploy()
  await furnaceImpl.deployed()

  const TradeImplFactory: ContractFactory = await hre.ethers.getContractFactory('GnosisTrade')
  const tradeImpl = <GnosisTrade>await TradeImplFactory.deploy()
  await tradeImpl.deployed()

  const BrokerImplFactory: ContractFactory = await hre.ethers.getContractFactory('BrokerP1')
  const brokerImpl = <BrokerP1>await BrokerImplFactory.deploy()
  await brokerImpl.deployed()

  const RTokenImplFactory: ContractFactory = await hre.ethers.getContractFactory('RTokenP1', {
    libraries: { RewardableLibP1: rewardableLib.address },
  })
  const rTokenImpl = <RTokenP1>await RTokenImplFactory.deploy()
  await rTokenImpl.deployed()

  const StRSRImplFactory: ContractFactory = await hre.ethers.getContractFactory('StRSRP1Votes')
  const stRSRImpl = <StRSRP1Votes>await StRSRImplFactory.deploy()
  await stRSRImpl.deployed()

  // Assets - Can use dummy data in constructor as only logic will be used
  const RTokenAssetFactory: ContractFactory = await hre.ethers.getContractFactory('RTokenAsset', {
    libraries: { RTokenPricingLib: rTokenPricing.address },
  })
  const rTokenAssetImpl = <RTokenAsset>await RTokenAssetFactory.deploy(bn(0), ZERO_ADDRESS)
  await rTokenAssetImpl.deployed()

  const AavePricedAssetFactory: ContractFactory = await hre.ethers.getContractFactory(
    'AavePricedAsset'
  )
  const aavePricedAssetImpl = <AavePricedAsset>(
    await AavePricedAssetFactory.deploy(ZERO_ADDRESS, bn(0), ZERO_ADDRESS, ZERO_ADDRESS)
  )
  await aavePricedAssetImpl.deployed()

  const CompoundPricedAssetFactory: ContractFactory = await hre.ethers.getContractFactory(
    'CompoundPricedAsset'
  )
  const compoundPricedAssetImpl = <CompoundPricedAsset>(
    await CompoundPricedAssetFactory.deploy(ZERO_ADDRESS, bn(0), ZERO_ADDRESS)
  )
  await compoundPricedAssetImpl.deployed()

  return {
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
}

export const basketsNeededAmts = [fp('0.33'), fp('0.33'), fp('0.34')]

// RToken basket
const basket = [
  {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'aDAI',
    deployer: createATokenCollateral,
  },
  {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'cUSDC',
    deployer: createCTokenCollateral,
  },
  {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'cUSDT',
    deployer: createCTokenCollateral,
  },
]

export const deployCollaterals = (hre: HardhatRuntimeEnvironment): Promise<[string, string][]> => {
  return Promise.all(
    basket.map((basketToken) => basketToken.deployer(hre, basketToken.symbol, basketToken.address))
  )
}
