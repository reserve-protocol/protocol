import { GnosisMock } from '@typechain/GnosisMock'
import { ContractFactory } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { bn, fp } from '../../common/numbers'
import { IConfig } from '../../test/fixtures'
import { ATokenFiatCollateral, CTokenFiatCollateral } from '../../typechain'
import { CTokenMock } from './../../typechain/CTokenMock.d'
import { StaticATokenMock } from './../../typechain/StaticATokenMock.d'

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

  return [erc20.address, collateral.address]
}

const createCTokenCollateral = async (
  hre: HardhatRuntimeEnvironment,
  symbol: string,
  underlyingAddress: string
): Promise<[string, string]> => {
  // Factory contracts
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
  await collateral.deployed()

  return [erc20.address, collateral.address]
}

export const deployMarket = async (hre: HardhatRuntimeEnvironment): Promise<string> => {
  const GnosisMockFactory: ContractFactory = await hre.ethers.getContractFactory('GnosisMock')
  const marketMock: GnosisMock = <GnosisMock>await GnosisMockFactory.deploy()
  await marketMock.deployed()

  return marketMock.address
}

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

export const basketsNeededAmts = [fp('0.33'), fp('0.33'), fp('0.34')]

export const deployCollaterals = (hre: HardhatRuntimeEnvironment): Promise<[string, string][]> => {
  return Promise.all(
    basket.map((basketToken, index) =>
      basketToken.deployer(hre, basketToken.symbol, basketToken.address)
    )
  )
}
