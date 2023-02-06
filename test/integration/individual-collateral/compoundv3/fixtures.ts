import { ethers } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REWARDS,
  USDC_USD_PRICE_FEED,
  CUSDC_V3,
  COMP,
  MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  USDC,
  ORACLE_ERROR,
} from './helpers'
import {
  ERC20Mock,
  CTokenV3Collateral,
  MockV3Aggregator,
  CometInterface,
  CusdcV3Wrapper,
  CusdcV3Wrapper__factory,
  MockV3Aggregator__factory,
  CometMock,
  CometMock__factory,
} from '../../../../typechain'
import { bn } from '../../../../common/numbers'

interface Collateral {
  collateral: CTokenV3Collateral
  chainlinkFeed: MockV3Aggregator
  cusdcV3: CometInterface
  wcusdcV3: CusdcV3Wrapper
  usdc: ERC20Mock
}

interface CollateralOpts {
  erc20?: string
  targetName?: string
  rewardERC20?: string
  priceTimeout?: BigNumberish
  chainlinkFeed?: string
  oracleError?: BigNumberish
  oracleTimeout?: BigNumberish
  maxTradeVolume?: BigNumberish
  defaultThreshold?: BigNumberish
  delayUntilDefault?: BigNumberish
  reservesThresholdIffy?: BigNumberish
  reservesThresholdDisabled?: BigNumberish
}

export const defaultCollateralOpts: CollateralOpts = {
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: COMP,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: USDC_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  reservesThresholdIffy: bn('10000'),
  reservesThresholdDisabled: bn('5000'),
}

// type Fixture<T> = () => Promise<T>

// To successfully deploy, we would need to provide `opts.erc20` which would be an address where a
// `CusdcV3Wrapper` is deployed. Without a valid `CusdV3Wrapper`, it would fail on deployment since
// the collateral uses the wrapper's exchange rate as `refPerTok()`.
export const deployCollateral = async (opts: CollateralOpts = {}): Promise<CTokenV3Collateral> => {
  opts = { ...defaultCollateralOpts, ...opts }

  const CTokenV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CTokenV3Collateral'
  )
  const collateral = <CTokenV3Collateral>await CTokenV3CollateralFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed,
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout,
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    {
      rewardERC20: opts.rewardERC20,
      reservesThresholdIffy: opts.reservesThresholdIffy,
      reservesThresholdDisabled: opts.reservesThresholdDisabled,
    },
    0
  )
  await collateral.deployed()

  return collateral
}

export const makeCollateral = (opts: CollateralOpts = {}): Fixture<Collateral> => {
  const collateralOpts = { ...defaultCollateralOpts, ...opts }

  const makeCollateralFixture = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const fix = await makewCSUDC()
    const cusdcV3 = <CometInterface>fix.cusdcV3
    const { wcusdcV3, usdc } = fix

    if (collateralOpts.erc20 === undefined) {
      collateralOpts.erc20 = fix.wcusdcV3.address
    }

    const collateral = await deployCollateral(collateralOpts)
    return { collateral, chainlinkFeed, cusdcV3, wcusdcV3, usdc }
  }

  return makeCollateralFixture
}

interface CollateralWithMockComet {
  collateral: CTokenV3Collateral
  chainlinkFeed: MockV3Aggregator
  cusdcV3: CometMock
  wcusdcV3: CusdcV3Wrapper
  usdc: ERC20Mock
}

export const makeCollateralCometMock = (
  opts: CollateralOpts = {}
): Fixture<CollateralWithMockComet> => {
  const collateralOpts = { ...defaultCollateralOpts, ...opts }

  const makeCollateralFixtureMock = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )
    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
    const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'))

    const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
      await ethers.getContractFactory('CusdcV3Wrapper')
    )
    const wcusdcV3 = <CusdcV3Wrapper>(
      await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
    )
    collateralOpts.erc20 = wcusdcV3.address
    const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
    const collateral = await deployCollateral(collateralOpts)
    return { collateral, chainlinkFeed, cusdcV3, wcusdcV3, usdc }
  }

  return makeCollateralFixtureMock
}

interface WrappedcUSDCFixture {
  cusdcV3: CometInterface
  wcusdcV3: CusdcV3Wrapper
  usdc: ERC20Mock
}

export const makewCSUDC = async (): Promise<WrappedcUSDCFixture> => {
  const cusdcV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDC_V3)
  const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
    await ethers.getContractFactory('CusdcV3Wrapper')
  )
  const wcusdcV3 = <CusdcV3Wrapper>(
    await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
  )
  const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)

  return { cusdcV3, wcusdcV3, usdc }
}

export const cusdcFixture: Fixture<WrappedcUSDCFixture> =
  async function (): Promise<WrappedcUSDCFixture> {
    const cusdcV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDC_V3)
    const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
      await ethers.getContractFactory('CusdcV3Wrapper')
    )
    const wcusdcV3 = <CusdcV3Wrapper>(
      await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
    )
    const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)

    return { cusdcV3, wcusdcV3, usdc }
  }
