import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintETHx } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  WETH9,
  IETHx,
  IStaderOracle,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ETH_ORACLE_ERROR,
  ETH_ORACLE_TIMEOUT,
  ETHX_ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  ETHx,
  ETH_USD_PRICE_FEED,
  ETHx_ETH_PRICE_FEED,
  STADER_ORACLE,
} from './constants'
import { setCode } from '@nomicfoundation/hardhat-network-helpers'

/*
  Define interfaces
*/

interface ETHxCollateralFixtureContext extends CollateralFixtureContext {
  weth: WETH9
  ethx: IETHx
  targetPerTokChainlinkFeed: MockV3Aggregator
}

interface ETHxCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultETHxCollateralOpts: ETHxCollateralOpts = {
  erc20: ETHx,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ETH_ORACLE_TIMEOUT,
  oracleError: ETH_ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  targetPerTokChainlinkFeed: ETHx_ETH_PRICE_FEED,
  targetPerTokChainlinkTimeout: ETHX_ORACLE_TIMEOUT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: ETHxCollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultETHxCollateralOpts, ...opts }

  const ETHxCollateralFactory: ContractFactory = await ethers.getContractFactory('ETHxCollateral')

  const collateral = <TestICollateral>await ETHxCollateralFactory.deploy(
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
    opts.targetPerTokChainlinkFeed,
    opts.targetPerTokChainlinkTimeout,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // Push forward chainlink feed
  await pushOracleForward(opts.chainlinkFeed!)
  await pushOracleForward(opts.targetPerTokChainlinkFeed!)

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const refPerTokChainlinkDefaultAnswer = fp('1.0559')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: ETHxCollateralOpts = {}
): Fixture<ETHxCollateralFixtureContext> => {
  const collateralOpts = { ...defaultETHxCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    const targetPerTokChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address
    collateralOpts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address

    const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
    const ethx = (await ethers.getContractAt('IETHx', ETHx)) as IETHx
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      ethx,
      targetPerTokChainlinkFeed,
      tok: ethx,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<ETHxCollateralFixtureContext> = async (
  ctx: ETHxCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintETHx(ctx.ethx, user, amount, recipient)
}

const changeTargetPerRef = async (ctx: ETHxCollateralFixtureContext, percentChange: BigNumber) => {
  // We leave the actual refPerTok exchange where it is and just change {target/tok}
  {
    const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
    await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
  }
}

const reduceTargetPerRef = async (ctx: ETHxCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: ETHxCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease))
}

const changeRefPerTok = async (ctx: ETHxCollateralFixtureContext, percentChange: BigNumberish) => {
  // get current exchange rate
  const staderOracke: IStaderOracle = await ethers.getContractAt('IStaderOracle', STADER_ORACLE)
  const [reportingBlockNumber, totalETHBalance, totalETHXSupply] =
    await staderOracke.getExchangeRate()

  // save old bytecode
  const oldBytecode = await network.provider.send('eth_getCode', [STADER_ORACLE])

  // replace with mock (includes setter)
  const mockFactory = await ethers.getContractFactory('StaderOracleMock')
  const mock = await mockFactory.deploy()
  const bytecode = await network.provider.send('eth_getCode', [mock.address])
  await setCode(STADER_ORACLE, bytecode)

  // set new rate
  const staderOracleAsMock = await ethers.getContractAt('StaderOracleMock', STADER_ORACLE)
  const newBalance = totalETHBalance.add(totalETHBalance.mul(percentChange).div(100))

  await staderOracleAsMock.setExchangeRate({
    reportingBlockNumber,
    totalETHBalance: newBalance,
    totalETHXSupply,
  })

  // restore bytecode
  await setCode(STADER_ORACLE, oldBytecode)

  const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
  await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

const reduceRefPerTok = async (ctx: ETHxCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))
}

const increaseRefPerTok = async (ctx: ETHxCollateralFixtureContext, pctIncrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctIncrease))
}

const getExpectedPrice = async (ctx: ETHxCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const clRptData = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const clRptDecimals = await ctx.targetPerTokChainlinkFeed.decimals()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(clRptData.answer.mul(bn(10).pow(18 - clRptDecimals)))
    .div(fp('1'))
}

/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {
  it('does not allow missing targetPerTok chainlink feed', async () => {
    await expect(
      deployCollateral({ targetPerTokChainlinkFeed: ethers.constants.AddressZero })
    ).to.be.revertedWith('missing targetPerTok feed')
  })

  it('does not allow targetPerTok oracle timeout at 0', async () => {
    await expect(deployCollateral({ targetPerTokChainlinkTimeout: 0 })).to.be.revertedWith(
      'targetPerTokChainlinkTimeout zero'
    )
  })
}

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
  itChecksTargetPerRefDefault: it,
  itChecksTargetPerRefDefaultUp: it,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it,
  itHasRevenueHiding: it,
  resetFork,
  collateralName: 'Stader ETHx',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
}

collateralTests(opts)
