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
import { whileImpersonating } from '#/test/utils/impersonation'
import { pushOracleForward } from '../../../utils/oracles'
import { getResetFork } from '../helpers'

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

type AltParams = {
  testName: string
  aavePool: string
  aaveIncentivesController: string
  aToken: string
  whaleTokenHolder: string
  forkBlock: number
  targetNetwork: 'mainnet' | 'base' | 'arbitrum'
  toleranceDivisor?: BigNumber
}

export const makeTests = (defaultCollateralOpts: CollateralParams, altParams: AltParams) => {
  const deployCollateral = async (opts: Partial<CollateralParams> = {}) => {
    const combinedOpts = { ...defaultCollateralOpts, ...opts }
    const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')

    if (!combinedOpts.erc20 || combinedOpts.erc20 === '') {
      const V3LMFactory = await ethers.getContractFactory('MockStaticATokenV3LM')
      const staticWrapper = await V3LMFactory.deploy(
        altParams.aavePool,
        altParams.aaveIncentivesController
      )
      await staticWrapper.deployed()
      await staticWrapper.initialize(altParams.aToken, 'Static Token', 'saToken') // doesn't really matter.

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

    // Push forward chainlink feed
    await pushOracleForward(combinedOpts.chainlinkFeed!)

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

    // Impersonate holder
    await whileImpersonating(altParams.whaleTokenHolder, async (signer) => {
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

    await staticWrapper.mockSetCustomRate(currentRate.mul(changeFactor).div(100))
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

  const stableOpts = {
    deployCollateral,
    collateralSpecificConstructorTests: noop,
    collateralSpecificStatusTests: noop,
    beforeEachRewardsTest: noop,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceRefPerTok,
    increaseRefPerTok,
    resetFork: getResetFork(altParams.forkBlock),
    collateralName: `Aave V3 Fiat Collateral (${altParams.testName})`,
    reduceTargetPerRef,
    increaseTargetPerRef,
    itClaimsRewards: it.skip, // untested: very complicated to get Aave to handout rewards, and none are live currently.
    // The StaticATokenV3LM contract is formally verified and the function we added for claimRewards() is pretty obviously correct.
    itChecksTargetPerRefDefault: it,
    itChecksTargetPerRefDefaultUp: it,
    itChecksRefPerTokDefault: it,
    itHasRevenueHiding: it,
    itChecksNonZeroDefaultThreshold: it,
    itIsPricedByPeg: true,
    chainlinkDefaultAnswer: 1e8,
    itChecksPriceChanges: it,
    getExpectedPrice,
    toleranceDivisor: altParams.toleranceDivisor ?? bn('1e9'), // 1e15 adjusted for ((x + 1)/x) timestamp precision
    targetNetwork: altParams.targetNetwork,
  }

  return collateralTests(stableOpts)
}
