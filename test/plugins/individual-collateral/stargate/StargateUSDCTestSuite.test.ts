import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  StargatePoolMock,
  IStargatePoolWrapper,
  StargatePoolWrapper__factory,
  IStargateLPStaking,
} from '@typechain/index'
import { bn, fp } from '#/common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  STARGATE,
  USDC_USD_PRICE_FEED,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  SUSDC,
  ORACLE_TIMEOUT,
  ORACLE_ERROR,
} from './constants'
import { noop } from 'lodash'

/*
  Define interfaces
*/

interface StargateCollateralFixtureContext extends CollateralFixtureContext {
  pool: StargatePoolMock
  wpool: IStargatePoolWrapper
  stargate: ERC20Mock
  stakingContract: IStargateLPStaking
}

export enum CollateralType {
  STABLE,
  VOLATILE,
}

export interface StargateCollateralOpts extends CollateralOpts {
  type?: CollateralType
}

/*
  Define deployment functions
*/

export const defaultStargateCollateralOpts: StargateCollateralOpts = {
  erc20: SUSDC,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: STARGATE,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: USDC_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  type: CollateralType.STABLE,
}

export const deployCollateral = async (
  opts: StargateCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultStargateCollateralOpts, ...opts }

  const StargatePoolCollateralFactory: ContractFactory = await ethers.getContractFactory(
    opts.type === CollateralType.STABLE ? 'StargatePoolFiatCollateral' : 'StargatePoolETHCollateral'
  )

  const collateral = <TestICollateral>await StargatePoolCollateralFactory.deploy(
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
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: StargateCollateralOpts = {}
): Fixture<StargateCollateralFixtureContext> => {
  const collateralOpts = { ...defaultStargateCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    return deployCollateralStargateMockContext(collateralOpts)
  }

  return makeCollateralFixtureContext
}

const deployCollateralStargateMockContext = async (
  opts: StargateCollateralOpts = {}
): Promise<StargateCollateralFixtureContext> => {
  const collateralOpts = { ...defaultStargateCollateralOpts, ...opts }

  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )
  let chainlinkFeed: MockV3Aggregator
  if (collateralOpts.type === CollateralType.STABLE)
    chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
  else {
    chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1995e8'))
  }
  collateralOpts.chainlinkFeed = chainlinkFeed.address

  const StargatePoolWrapperFactory = <StargatePoolWrapper__factory>(
    await ethers.getContractFactory('StargatePoolWrapper')
  )
  const stargate = await (
    await ethers.getContractFactory('ERC20Mock')
  ).deploy('Stargate Mocked token', 'S*MT')
  const stakingContract = await (
    await ethers.getContractFactory('StargateLPStakingMock')
  ).deploy(stargate.address)
  const mockPool = await (
    await ethers.getContractFactory('StargatePoolMock')
  ).deploy('Mock Pool', 'MSP', collateralOpts.type === CollateralType.STABLE ? 6 : 8)
  await stakingContract.add(bn('5000'), mockPool.address)
  await mockPool.mint(stakingContract.address, bn(1))
  await mockPool.setExchangeRate(fp(1))
  const wrapper = await StargatePoolWrapperFactory.deploy(
    'wMocked Pool',
    'wMSP',
    stargate.address,
    stakingContract.address,
    mockPool.address
  )
  collateralOpts.erc20 = wrapper.address
  collateralOpts.rewardERC20 = stargate.address

  const collateral = await deployCollateral(collateralOpts)

  const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', STARGATE)

  return {
    collateral,
    chainlinkFeed,
    tok: wrapper,
    rewardToken,
    pool: mockPool,
    wpool: wrapper,
    stargate,
    stakingContract,
  }
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<StargateCollateralFixtureContext> = async (
  ctx: StargateCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  const currentExchangeRate = await ctx.collateral.refPerTok()

  // ctx.stakingContract

  await ctx.pool.connect(user).approve(ctx.wpool.address, ethers.constants.MaxUint256)
  await ctx.pool.mint(user.address, amount)
  await ctx.wpool.connect(user).deposit(amount)
  await ctx.wpool.connect(user).transfer(recipient, amount)
  await ctx.pool.setExchangeRate(currentExchangeRate.add(fp('0.000001')))
}

const reduceRefPerTok = async (
  ctx: StargateCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const currentExchangeRate = await ctx.collateral.refPerTok()
  await ctx.pool.setExchangeRate(
    currentExchangeRate.sub(currentExchangeRate.mul(pctDecrease).div(100))
  )
}

const increaseRefPerTok = async (
  ctx: StargateCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const currentExchangeRate = await ctx.collateral.refPerTok()
  await ctx.pool.setExchangeRate(
    currentExchangeRate.add(currentExchangeRate.mul(pctIncrease).div(100))
  )
}

const getExpectedPrice = async (ctx: StargateCollateralFixtureContext): Promise<BigNumber> => {
  const initRefPerTok = await ctx.collateral.refPerTok()

  const decimals = await ctx.chainlinkFeed.decimals()

  const initData = await ctx.chainlinkFeed.latestRoundData()
  return initData.answer
    .mul(bn(10).pow(18 - decimals))
    .mul(initRefPerTok)
    .div(fp('1'))
}

const reduceTargetPerRef = async (
  ctx: StargateCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (
  ctx: StargateCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

/*
  Run the test suite
*/

export const stableOpts = {
  deployCollateral,
  collateralSpecificConstructorTests: noop,
  collateralSpecificStatusTests: noop,
  beforeEachRewardsTest: noop,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceRefPerTok,
  increaseRefPerTok,
  resetFork: noop,
  collateralName: 'Stargate USDC Pool',
  reduceTargetPerRef,
  increaseTargetPerRef,
  itClaimsRewards: it.skip, // claims on deposit/withdraw, reward growth not supported in mock
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it,
  itHasRevenueHiding: it.skip, // no revenue hiding
  itIsPricedByPeg: true,
  chainlinkDefaultAnswer: 1e8,
  itChecksPriceChanges: it,
  getExpectedPrice,
}

collateralTests(stableOpts)
