import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintRETH } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IReth,
  WETH9,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  RETH,
  ETH_USD_PRICE_FEED,
  RETH_ETH_PRICE_FEED,
  RETH_NETWORK_BALANCES,
  RETH_STORAGE,
} from './constants'
import { whileImpersonating } from '#/test/utils/impersonation'

/*
  Define interfaces
*/

interface RethCollateralFixtureContext extends CollateralFixtureContext {
  weth: WETH9
  reth: IReth
  refPerTokChainlinkFeed: MockV3Aggregator
}

interface RethCollateralOpts extends CollateralOpts {
  refPerTokChainlinkFeed?: string
  refPerTokChainlinkTimeout?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultRethCollateralOpts: RethCollateralOpts = {
  erc20: RETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: WETH,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  refPerTokChainlinkFeed: RETH_ETH_PRICE_FEED,
  refPerTokChainlinkTimeout: ORACLE_TIMEOUT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: RethCollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultRethCollateralOpts, ...opts }

  const RethCollateralFactory: ContractFactory = await ethers.getContractFactory('RethCollateral')

  const collateral = <TestICollateral>await RethCollateralFactory.deploy(
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
    opts.revenueHiding,
    opts.refPerTokChainlinkFeed,
    opts.refPerTokChainlinkTimeout,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()
  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const refPerTokChainlinkDefaultAnswer = fp('1')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: RethCollateralOpts = {}
): Fixture<RethCollateralFixtureContext> => {
  const collateralOpts = { ...defaultRethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    const refPerTokChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address
    collateralOpts.refPerTokChainlinkFeed = refPerTokChainlinkFeed.address

    const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
    const reth = (await ethers.getContractAt('IReth', RETH)) as IReth
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      reth,
      refPerTokChainlinkFeed,
      tok: reth,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

// const deployCollateralCometMockContext = async (
//   opts: CometCollateralOpts = {}
// ): Promise<RethCollateralFixtureContextMockComet> => {
//   const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

//   const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
//     await ethers.getContractFactory('MockV3Aggregator')
//   )
//   const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
//   collateralOpts.chainlinkFeed = chainlinkFeed.address

//   const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
//   const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'), CUSDC_V3)

//   const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
//     await ethers.getContractFactory('CusdcV3Wrapper')
//   )
//   const wcusdcV3 = <ICusdcV3Wrapper>(
//     await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
//   )
//   const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
//     await ethers.getContractFactory('CusdcV3WrapperMock')
//   )
//   const wcusdcV3Mock = await (<ICusdcV3WrapperMock>(
//     await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)
//   ))

//   const realMock = (await ethers.getContractAt(
//     'ICusdcV3WrapperMock',
//     wcusdcV3Mock.address
//   )) as ICusdcV3WrapperMock
//   collateralOpts.erc20 = wcusdcV3.address
//   collateralOpts.erc20 = realMock.address
//   const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
//   const collateral = await deployCollateral(collateralOpts)

//   const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

//   return {
//     collateral,
//     chainlinkFeed,
//     cusdcV3,
//     wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
//     wcusdcV3Mock,
//     usdc,
//     tok: wcusdcV3,
//     rewardToken,
//   }
// }

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<RethCollateralFixtureContext> = async (
  ctx: RethCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintRETH(ctx.reth, user, amount, recipient)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

const rocketBalanceKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('network.balance.total'))

// prettier-ignore
const reduceRefPerTok = async (
  ctx: RethCollateralFixtureContext,
  pctDecrease: BigNumberish 
) => {
  const rethNetworkBalances = await ethers.getContractAt(
    'IRocketNetworkBalances',
    RETH_NETWORK_BALANCES
  )
  const currentTotalEth = await rethNetworkBalances.getTotalETHBalance()
  const lowerBal = currentTotalEth.sub(currentTotalEth.mul(pctDecrease).div(100))
  const rocketStorage = await ethers.getContractAt('IRocketStorage', RETH_STORAGE)
  await whileImpersonating(RETH_NETWORK_BALANCES, async (rethSigner) => {
    await rocketStorage.connect(rethSigner).setUint(rocketBalanceKey, lowerBal)
  })

  const lastRound = await ctx.refPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.refPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: RethCollateralFixtureContext,
  pctIncrease: BigNumberish 
) => {
  const rethNetworkBalances = await ethers.getContractAt(
    'IRocketNetworkBalances',
    RETH_NETWORK_BALANCES
  )
  const currentTotalEth = await rethNetworkBalances.getTotalETHBalance()
  const lowerBal = currentTotalEth.add(currentTotalEth.mul(pctIncrease).div(100))
  const rocketStorage = await ethers.getContractAt('IRocketStorage', RETH_STORAGE)
  await whileImpersonating(RETH_NETWORK_BALANCES, async (rethSigner) => {
    await rocketStorage.connect(rethSigner).setUint(rocketBalanceKey, lowerBal)
  })

  const lastRound = await ctx.refPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.refPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

const getExpectedPrice = async (ctx: RethCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const clRptData = await ctx.refPerTokChainlinkFeed.latestRoundData()
  const clRptDecimals = await ctx.refPerTokChainlinkFeed.decimals()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(clRptData.answer.mul(bn(10).pow(18 - clRptDecimals)))
    .div(fp('1'))
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  beforeEachRewardsTest,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceTargetPerRef,
  increaseTargetPerRef,
  reduceRefPerTok,
  increaseRefPerTok,
  getExpectedPrice,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it,
  resetFork,
  collateralName: 'RocketPoolETH',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
