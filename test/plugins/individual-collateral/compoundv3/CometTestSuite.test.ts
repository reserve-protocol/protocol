import collateralTests from '../collateralTests'
import {
  CollateralFixtureContext,
  CollateralOpts,
  MintCollateralFunc,
  CollateralStatus,
} from '../pluginTestTypes'
import { allTests, CTokenV3Enumeration, mintWcToken, enableRewardsAccrual } from './helpers'
import { ethers, network } from 'hardhat'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  CometInterface,
  CFiatV3Wrapper__factory,
  CFiatV3WrapperMock__factory,
  MockV3Aggregator__factory,
  CometMock,
  CometMock__factory,
  TestICollateral,
  ICFiatV3Wrapper,
  CFiatV3WrapperMock,
} from '../../../../typechain'
import { getResetFork } from '../helpers'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'
import { MAX_UINT48 } from '../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { advanceBlocks, getLatestBlockTimestamp, setNextBlockTimestamp } from '../../../utils/time'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  COMP,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REWARDS,
  COMET_EXT,
  getForkBlock,
} from './constants'
import { setCode } from '@nomicfoundation/hardhat-network-helpers'

/*
  Define interfaces
*/

interface CometCollateralFixtureContext extends CollateralFixtureContext {
  cTokenV3: CometInterface
  wcTokenV3: ICFiatV3Wrapper
  token: ERC20Mock
}

interface CometCollateralFixtureContextMockComet extends CollateralFixtureContext {
  cTokenV3: CometMock
  wcTokenV3: ICFiatV3Wrapper
  token: ERC20Mock
  wcTokenV3Mock: CFiatV3WrapperMock
}

interface CometCollateralOpts extends CollateralOpts {
  reservesThresholdIffy?: BigNumberish
}

/*
  Define deployment functions
*/

const chainlinkDefaultAnswer = bn('1e8')

allTests.forEach((curr: CTokenV3Enumeration) => {
  const defaultCometCollateralOpts: CometCollateralOpts = {
    erc20: curr.cTokenV3,
    targetName: ethers.utils.formatBytes32String('USD'),
    rewardERC20: COMP,
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: curr.chainlinkFeed,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: ORACLE_ERROR,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    revenueHiding: fp('0'),
  }

  const deployCollateral = async (opts: CometCollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCometCollateralOpts, ...opts }

    const CTokenV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenV3Collateral'
    )

    const collateral = <TestICollateral>await CTokenV3CollateralFactory.deploy(
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
      { gasLimit: 2000000000 }
    )

    await collateral.deployed()

    // Push forward chainlink feed
    await pushOracleForward(opts.chainlinkFeed!)

    // sometimes we are trying to test a negative test case and we want this to fail silently
    // fortunately this syntax fails silently because our tools are terrible
    await expect(collateral.refresh())

    return collateral
  }

  type Fixture<T> = () => Promise<T>

  const makeCollateralFixtureContext = (
    alice: SignerWithAddress,
    opts: CometCollateralOpts = {}
  ): Fixture<CometCollateralFixtureContext> => {
    const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

    const makeCollateralFixtureContext = async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      const chainlinkFeed = <MockV3Aggregator>(
        await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
      )
      collateralOpts.chainlinkFeed = chainlinkFeed.address

      const fix = await curr.fix()
      const cTokenV3 = <CometInterface>fix.cTokenV3
      const { wcTokenV3, token } = fix

      collateralOpts.erc20 = wcTokenV3.address
      const collateral = await deployCollateral(collateralOpts)
      const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

      return {
        alice,
        collateral,
        chainlinkFeed,
        cTokenV3,
        wcTokenV3,
        token,
        tok: wcTokenV3,
        rewardToken,
      }
    }

    return makeCollateralFixtureContext
  }

  const deployCollateralCometMockContext = async (
    opts: CometCollateralOpts = {}
  ): Promise<CometCollateralFixtureContextMockComet> => {
    const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )
    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
    const cTokenV3 = <CometMock>await CometFactory.deploy(curr.cTokenV3)

    const CTokenV3WrapperFactory = <CFiatV3Wrapper__factory>(
      await ethers.getContractFactory('CFiatV3Wrapper')
    )

    const wcTokenV3 = <ICFiatV3Wrapper>(
      ((await CTokenV3WrapperFactory.deploy(
        cTokenV3.address,
        REWARDS,
        COMP,
        curr.wrapperName,
        curr.wrapperSymbol,
        fp('1')
      )) as unknown as ICFiatV3Wrapper)
    )
    const CTokenV3WrapperMockFactory = <CFiatV3WrapperMock__factory>(
      await ethers.getContractFactory('CFiatV3WrapperMock')
    )
    const wcTokenV3Mock = <ICFiatV3WrapperMock>(
      ((await CTokenV3WrapperMockFactory.deploy(wcTokenV3.address)) as unknown)
    )

    collateralOpts.erc20 = wcTokenV3Mock.address
    const token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', curr.token)
    const collateral = await deployCollateral(collateralOpts)
    const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

    return {
      collateral,
      chainlinkFeed,
      cTokenV3,
      wcTokenV3: wcTokenV3Mock,
      wcTokenV3Mock: wcTokenV3Mock as unknown as CFiatV3WrapperMock,
      token,
      tok: wcTokenV3,
      rewardToken,
    }
  }

  /*
    Define helper functions
  */

  const mintCollateralTo: MintCollateralFunc<CometCollateralFixtureContext> = async (
    ctx: CometCollateralFixtureContext,
    amount: BigNumberish,
    user: SignerWithAddress,
    recipient: string
  ) => {
    await mintWcToken(
      ctx.token,
      ctx.cTokenV3,
      ctx.tok as unknown as ICFiatV3Wrapper,
      user,
      amount,
      recipient
    )
  }

  const reduceTargetPerRef = async (
    ctx: CometCollateralFixtureContext,
    pctDecrease: BigNumberish
  ) => {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }

  const increaseTargetPerRef = async (
    ctx: CometCollateralFixtureContext,
    pctIncrease: BigNumberish
  ) => {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }

  const reduceRefPerTok = async (ctx: CometCollateralFixtureContext, pctDecrease: BigNumberish) => {
    const totalsBasic = await ctx.cTokenV3.totalsBasic()
    const bsi = totalsBasic.baseSupplyIndex

    // save old bytecode
    const oldBytecode = await network.provider.send('eth_getCode', [COMET_EXT])

    const mockFactory = await ethers.getContractFactory('CometExtMock')
    const mock = await mockFactory.deploy()
    const bytecode = await network.provider.send('eth_getCode', [mock.address])
    await setCode(COMET_EXT, bytecode)

    const cometAsMock = await ethers.getContractAt('CometExtMock', ctx.cTokenV3.address)
    await cometAsMock.setBaseSupplyIndex(bsi.sub(bsi.mul(pctDecrease).div(100)))

    await setCode(COMET_EXT, oldBytecode)
  }

  const increaseRefPerTok = async () => {
    await advanceBlocks(1000)
    await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)
  }

  const getExpectedPrice = async (ctx: CometCollateralFixtureContext): Promise<BigNumber> => {
    const initRefPerTok = await ctx.collateral.underlyingRefPerTok()

    const decimals = await ctx.chainlinkFeed.decimals()

    const initData = await ctx.chainlinkFeed.latestRoundData()
    return initData.answer
      .mul(bn(10).pow(18 - decimals))
      .mul(initRefPerTok)
      .div(fp('1'))
  }

  /*
    Define collateral-specific tests
  */

  const collateralSpecificConstructorTests = () => {
    return
  }

  const collateralSpecificStatusTests = () => {
    it('does revenue hiding correctly', async () => {
      const { collateral, wcTokenV3Mock } = await deployCollateralCometMockContext({
        revenueHiding: fp('0.01'),
      })

      // Should remain SOUND after a 1% decrease
      let refPerTok = await collateral.refPerTok()
      let currentExchangeRate = await wcTokenV3Mock.exchangeRate()
      await wcTokenV3Mock.setMockExchangeRate(
        true,
        currentExchangeRate.sub(currentExchangeRate.mul(1).div(100))
      )
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

      // refPerTok should be unchanged
      expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand

      // Should become DISABLED if drops more than that
      refPerTok = await collateral.refPerTok()
      currentExchangeRate = await wcTokenV3Mock.exchangeRate()
      await wcTokenV3Mock.setMockExchangeRate(
        true,
        currentExchangeRate.sub(currentExchangeRate.mul(1).div(100))
      )
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // refPerTok should have fallen 1%
      refPerTok = refPerTok.sub(refPerTok.div(100))
      expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand
    })

    it('enters DISABLED state when refPerTok() decreases', async () => {
      // Context: Usually this is left to generic suite, but we were having issues with the comet extensions
      //          on arbitrum as compared to ethereum mainnet, and this was the easiest way around it.

      const { collateral, wcTokenV3Mock } = await deployCollateralCometMockContext({})

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

      // Should default instantly after 5% drop
      const currentExchangeRate = await wcTokenV3Mock.exchangeRate()
      await wcTokenV3Mock.setMockExchangeRate(
        true,
        currentExchangeRate.sub(currentExchangeRate.mul(5).div(100))
      )
      await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
    })

    it('should not brick refPerTok() even if _underlyingRefPerTok() reverts', async () => {
      const { collateral, wcTokenV3Mock } = await deployCollateralCometMockContext({})
      await wcTokenV3Mock.setRevertExchangeRate(true)
      await expect(collateral.refresh()).not.to.be.reverted
      await expect(collateral.refPerTok()).not.to.be.reverted
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  }

  const beforeEachRewardsTest = async (ctx: CometCollateralFixtureContext) => {
    await enableRewardsAccrual(ctx.cTokenV3)
  }

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
    itClaimsRewards: it,
    itChecksTargetPerRefDefault: it,
    itChecksTargetPerRefDefaultUp: it,
    itChecksRefPerTokDefault: it.skip, // implemented in this file
    itChecksPriceChanges: it,
    itChecksNonZeroDefaultThreshold: it,
    itHasRevenueHiding: it.skip, // implemented in this file
    itIsPricedByPeg: true,
    resetFork: getResetFork(getForkBlock(curr.tokenName)),
    collateralName: curr.testName,
    chainlinkDefaultAnswer,
    targetNetwork: curr.forkNetwork,
  }

  collateralTests(opts)
})
