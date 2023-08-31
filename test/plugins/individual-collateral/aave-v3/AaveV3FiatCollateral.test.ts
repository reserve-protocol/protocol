import collateralTests from '../collateralTests'
import { CollateralFixtureContext, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { BigNumberish, BigNumber } from 'ethers'
import {
  TestICollateral,
  AaveV3FiatCollateral__factory,
  IERC20Metadata,
  MockStaticATokenV3LM,
} from '@typechain/index'
import { bn, fp } from '#/common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { noop } from 'lodash'
import { PRICE_TIMEOUT } from '#/test/fixtures'
import { networkConfig } from '#/common/configuration'
import { getResetFork } from '../helpers'
import { whileImpersonating } from '#/test/utils/impersonation'

interface AaveV3FiatCollateralFixtureContext extends CollateralFixtureContext {
  staticWrapper: MockStaticATokenV3LM
  baseToken: IERC20Metadata
}

/*
  Define deployment functions
*/

type CollateralParams = Parameters<AaveV3FiatCollateral__factory['deploy']>[0] & {
  revenueHiding?: BigNumberish
}

// This defines options for the Aave V3 USDC Market
export const defaultCollateralOpts: CollateralParams = {
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: networkConfig[1].chainlinkFeeds.USDC!,
  oracleError: fp('0.0025'),
  erc20: '', // to be set
  maxTradeVolume: fp('1e6'),
  oracleTimeout: bn('86400'),
  targetName: ethers.utils.formatBytes32String('USD'),
  defaultThreshold: fp('0.0125'),
  delayUntilDefault: bn('86400'),
}

export const deployCollateral = async (opts: Partial<CollateralParams> = {}) => {
  const combinedOpts = { ...defaultCollateralOpts, ...opts }
  const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')

  if (!combinedOpts.erc20 || combinedOpts.erc20 === '') {
    const V3LMFactory = await ethers.getContractFactory('MockStaticATokenV3LM')
    const staticWrapper = await V3LMFactory.deploy(
      '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', // USDC Pool
      '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb' // Aave V3 Incentives Controller
    )
    await staticWrapper.deployed()
    await staticWrapper.initialize(
      '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c',
      'Static Aave Ethereum USDC',
      'stataEthUSDC'
    )

    combinedOpts.erc20 = staticWrapper.address
  }

  const collateral = await CollateralFactory.deploy(
    combinedOpts,
    opts.revenueHiding ?? fp('0'), // change this to test with revenueHiding
    {
      gasLimit: 30000000,
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  // our tools really suck don't they
  return collateral as unknown as TestICollateral
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts = {}
): Fixture<AaveV3FiatCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const collateral = await deployCollateral({
      ...collateralOpts,
      chainlinkFeed: chainlinkFeed.address,
    })

    const staticWrapper = await ethers.getContractAt(
      'MockStaticATokenV3LM',
      await collateral.erc20()
    )

    return {
      collateral,
      staticWrapper,
      chainlinkFeed,
      tok: await ethers.getContractAt('IERC20Metadata', await collateral.erc20()),
      baseToken: await ethers.getContractAt('IERC20Metadata', await staticWrapper.asset()),
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<AaveV3FiatCollateralFixtureContext> = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  const requiredCollat = await ctx.staticWrapper.previewMint(amount)

  // USDC Richie Rich
  await whileImpersonating('0x0A59649758aa4d66E25f08Dd01271e891fe52199', async (signer) => {
    await ctx.baseToken
      .connect(signer)
      .approve(ctx.staticWrapper.address, ethers.constants.MaxUint256)
    await ctx.staticWrapper
      .connect(signer)
      ['deposit(uint256,address,uint16,bool)'](requiredCollat, recipient, 0, true)
  })
}

const modifyRefPerTok = async (ctx: AaveV3FiatCollateralFixtureContext, changeFactor = 100) => {
  const staticWrapper = ctx.staticWrapper
  const currentRate = await staticWrapper.rate()

  await staticWrapper.mock_setCustomRate(currentRate.mul(changeFactor).div(100))
}

const reduceRefPerTok = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await modifyRefPerTok(ctx, 100 - Number(pctDecrease.toString()))
}

const increaseRefPerTok = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await modifyRefPerTok(ctx, 100 + Number(pctIncrease.toString()))
}

const getExpectedPrice = async (ctx: AaveV3FiatCollateralFixtureContext): Promise<BigNumber> => {
  const initRefPerTok = await ctx.collateral.refPerTok()
  const decimals = await ctx.chainlinkFeed.decimals()

  const initData = await ctx.chainlinkFeed.latestRoundData()
  return initData.answer
    .mul(bn(10).pow(18 - decimals))
    .mul(initRefPerTok)
    .div(fp('1'))
}

const reduceTargetPerRef = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))

  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (
  ctx: AaveV3FiatCollateralFixtureContext,
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
  resetFork: getResetFork(18000000),
  collateralName: 'Aave V3 Fiat Collateral (USDC)',
  reduceTargetPerRef,
  increaseTargetPerRef,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it,
  itHasRevenueHiding: it,
  itIsPricedByPeg: true,
  chainlinkDefaultAnswer: 1e8,
  itChecksPriceChanges: it,
  getExpectedPrice,
}

collateralTests(stableOpts)
