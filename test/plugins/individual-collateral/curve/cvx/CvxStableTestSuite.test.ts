import collateralTests from '../collateralTests'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { mintWPool, makeW3PoolStable, makeWSUSDPoolStable, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  IERC20,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { bn, fp } from '../../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  THREE_POOL,
  THREE_POOL_TOKEN,
  SUSD_POOL_TOKEN,
  CVX,
  DAI_USD_FEED,
  DAI_ORACLE_TIMEOUT,
  DAI_ORACLE_ERROR,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDT_USD_FEED,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  SUSD_USD_FEED,
  SUSD_ORACLE_TIMEOUT,
  SUSD_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  THREE_POOL_HOLDER,
} from '../constants'
import { whileImpersonating } from '#/test/utils/impersonation'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: DAI_USD_FEED, // unused but cannot be zero
  oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 3,
  curvePool: THREE_POOL,
  lpToken: THREE_POOL_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
  oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
  oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeW3PoolStable()

    opts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]
    opts.erc20 = fix.wrapper.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CurveStableCollateral'
  )

  const collateral = <TestICollateral>await CvxStableCollateralFactory.deploy(
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
    {
      nTokens: opts.nTokens,
      curvePool: opts.curvePool,
      poolType: opts.poolType,
      feeds: opts.feeds,
      oracleTimeouts: opts.oracleTimeouts,
      oracleErrors: opts.oracleErrors,
      lpToken: opts.lpToken,
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral, opts]
}

export const deployMaxTokensCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  const fix = await makeWSUSDPoolStable()

  // Set default options for max tokens case
  const maxTokenCollOpts = {
    ...defaultCvxStableCollateralOpts,
    ...{
      nTokens: 4,
      erc20: fix.wrapper.address,
      curvePool: fix.curvePool.address,
      lpToken: SUSD_POOL_TOKEN,
      feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED], [SUSD_USD_FEED, SUSD_USD_FEED]],
      oracleTimeouts: [
        [DAI_ORACLE_TIMEOUT],
        [USDC_ORACLE_TIMEOUT],
        [USDT_ORACLE_TIMEOUT],
        [SUSD_ORACLE_TIMEOUT, SUSD_ORACLE_TIMEOUT],
      ],
      oracleErrors: [
        [DAI_ORACLE_ERROR],
        [USDC_ORACLE_ERROR],
        [USDT_ORACLE_ERROR],
        [SUSD_ORACLE_ERROR],
      ],
    },
  }

  opts = { ...maxTokenCollOpts, ...opts }

  const CvxStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CurveStableCollateral'
  )

  const collateral = <TestICollateral>await CvxStableCollateralFactory.deploy(
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
    {
      nTokens: opts.nTokens,
      curvePool: opts.curvePool,
      poolType: opts.poolType,
      feeds: opts.feeds,
      oracleTimeouts: opts.oracleTimeouts,
      oracleErrors: opts.oracleErrors,
      lpToken: opts.lpToken,
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    collateralOpts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]

    const fix = await makeW3PoolStable()

    collateralOpts.erc20 = fix.wrapper.address
    collateralOpts.curvePool = fix.curvePool.address
    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.curvePool,
      wrapper: fix.wrapper,
      rewardTokens: [cvx, crv],
      poolTokens: [fix.dai, fix.usdc, fix.usdt],
      feeds: [daiFeed, usdcFeed, usdtFeed],
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCurveCollateralFunc<CurveCollateralFixtureContext> = async (
  ctx: CurveCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWPool(ctx, amount, user, recipient, THREE_POOL_HOLDER)
}

/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {
  describe('Handles constructor with 4 tokens (max allowed) - sUSD', () => {
    let collateral: TestICollateral
    before(resetFork)
    it('deploys plugin successfully', async () => {
      ;[collateral] = await deployMaxTokensCollateral()
      expect(await collateral.address).to.not.equal(ZERO_ADDRESS)
      const [low, high] = await collateral.price()
      expect(low).to.be.closeTo(fp('1.06'), fp('0.01')) // close to $1
      expect(high).to.be.closeTo(fp('1.07'), fp('0.01'))
      expect(high).to.be.gt(low)

      // Token price
      const cvxMultiFeedStableCollateral = await ethers.getContractAt(
        'CurveStableCollateral',
        collateral.address
      )
      for (let i = 0; i < 4; i++) {
        const [lowTkn, highTkn] = await cvxMultiFeedStableCollateral.tokenPrice(i)
        expect(lowTkn).to.be.closeTo(fp('1'), fp('0.01')) // close to $1
        expect(highTkn).to.be.closeTo(fp('1'), fp('0.01'))
        expect(highTkn).to.be.gt(lowTkn)
      }

      await expect(cvxMultiFeedStableCollateral.tokenPrice(5)).to.be.revertedWithCustomError(
        cvxMultiFeedStableCollateral,
        'WrongIndex'
      )
    })

    it('validates non-zero-address for final token - edge case', async () => {
      // Set empty the final feed
      let feeds = [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED], [ZERO_ADDRESS, ZERO_ADDRESS]]
      await expect(deployMaxTokensCollateral({ feeds })).to.be.revertedWith('t3feed0 empty')

      feeds = [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED], [SUSD_USD_FEED, ZERO_ADDRESS]]
      await expect(deployMaxTokensCollateral({ feeds })).to.be.revertedWith('t3feed1 empty')
    })

    it('validates non-zero oracle timeout for final token - edge case', async () => {
      // Set empty the final oracle timeouts
      let oracleTimeouts = [
        [DAI_ORACLE_TIMEOUT],
        [USDC_ORACLE_TIMEOUT],
        [USDT_ORACLE_TIMEOUT],
        [bn(0), bn(0)],
      ]
      await expect(deployMaxTokensCollateral({ oracleTimeouts })).to.be.revertedWith(
        't3timeout0 zero'
      )

      const feeds = [
        [DAI_USD_FEED],
        [USDC_USD_FEED],
        [USDT_USD_FEED],
        [SUSD_USD_FEED, SUSD_USD_FEED],
      ]
      oracleTimeouts = [
        [DAI_ORACLE_TIMEOUT],
        [USDC_ORACLE_TIMEOUT],
        [USDT_ORACLE_TIMEOUT],
        [SUSD_ORACLE_TIMEOUT, bn(0)],
      ]

      await expect(deployMaxTokensCollateral({ feeds, oracleTimeouts })).to.be.revertedWith(
        't3timeout1 zero'
      )
    })

    it('validates non-large oracle error for final token - edge case', async () => {
      // Set empty the final oracle errors
      let oracleErrors = [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR], [fp('1')]]
      await expect(deployMaxTokensCollateral({ oracleErrors })).to.be.revertedWith(
        't3error0 too large'
      )

      const feeds = [
        [DAI_USD_FEED],
        [USDC_USD_FEED],
        [USDT_USD_FEED],
        [SUSD_USD_FEED, SUSD_USD_FEED],
      ]
      const oracleTimeouts = [
        [DAI_ORACLE_TIMEOUT],
        [USDC_ORACLE_TIMEOUT],
        [USDT_ORACLE_TIMEOUT],
        [SUSD_ORACLE_TIMEOUT, SUSD_ORACLE_TIMEOUT],
      ]

      oracleErrors = [
        [DAI_ORACLE_ERROR],
        [USDC_ORACLE_ERROR],
        [USDT_ORACLE_ERROR],
        [SUSD_ORACLE_ERROR, fp('1')],
      ]

      await expect(
        deployMaxTokensCollateral({ feeds, oracleTimeouts, oracleErrors })
      ).to.be.revertedWith('t3error1 too large')

      // If we don't specify it it will use 0
      oracleErrors = [
        [DAI_ORACLE_ERROR],
        [USDC_ORACLE_ERROR],
        [USDT_ORACLE_ERROR],
        [SUSD_ORACLE_ERROR],
      ]

      await expect(deployMaxTokensCollateral({ feeds, oracleTimeouts, oracleErrors })).to.not.be
        .reverted
    })
  })
}

const collateralSpecificStatusTests = () => {
  it('handles properly multiple price feeds', async () => {
    const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    const feed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const feedStable = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const fix = await makeW3PoolStable()

    const opts: CurveCollateralOpts = { ...defaultCvxStableCollateralOpts }
    const nonzeroError = opts.oracleTimeouts![0][0]
    const nonzeroTimeout = bn(opts.oracleTimeouts![0][0])
    const feeds = [
      [feed.address, feedStable.address],
      [feed.address, feedStable.address],
      [feed.address, feedStable.address],
    ]
    const oracleTimeouts = [
      [nonzeroTimeout, nonzeroTimeout],
      [nonzeroTimeout, nonzeroTimeout],
      [nonzeroTimeout, nonzeroTimeout],
    ]
    const oracleErrors = [
      [nonzeroError, nonzeroError],
      [nonzeroError, nonzeroError],
      [nonzeroError, nonzeroError],
    ]

    const [multiFeedCollateral] = await deployCollateral({
      erc20: fix.wrapper.address,
      feeds,
      oracleTimeouts,
      oracleErrors,
    })

    const initialRefPerTok = await multiFeedCollateral.refPerTok()
    const [low, high] = await multiFeedCollateral.price()

    // Update values in Oracles increase by 10%
    const initialPrice = await feed.latestRoundData()
    await (await feed.updateAnswer(initialPrice.answer.mul(110).div(100))).wait()

    const [newLow, newHigh] = await multiFeedCollateral.price()

    // with 18 decimals of price precision a 1e-9 tolerance seems fine for a 10% change
    // and without this kind of tolerance the Volatile pool tests fail due to small movements
    expect(newLow).to.be.closeTo(low.mul(110).div(100), fp('1e-9'))
    expect(newHigh).to.be.closeTo(high.mul(110).div(100), fp('1e-9'))

    // Check refPerTok remains the same (because we have not refreshed)
    const finalRefPerTok = await multiFeedCollateral.refPerTok()
    expect(finalRefPerTok).to.equal(initialRefPerTok)
  })

  it('handles shutdown correctly', async () => {
    const fix = await makeW3PoolStable()
    const [, alice, bob] = await ethers.getSigners()
    const amount = fp('100')
    const rewardPerBlock = bn('83197823300')

    const lpToken = <IERC20>(
      await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        await fix.wrapper.curveToken()
      )
    )
    const CRV = <IERC20>(
      await ethers.getContractAt(
        '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
        '0xD533a949740bb3306d119CC777fa900bA034cd52'
      )
    )
    await whileImpersonating(THREE_POOL_HOLDER, async (signer) => {
      await lpToken.connect(signer).transfer(alice.address, amount.mul(2))
    })

    await lpToken.connect(alice).approve(fix.wrapper.address, ethers.constants.MaxUint256)
    await fix.wrapper.connect(alice).deposit(amount, alice.address)

    // let's shutdown!
    await fix.wrapper.shutdown()

    const prevBalance = await CRV.balanceOf(alice.address)
    await fix.wrapper.connect(alice).claimRewards()
    expect(await CRV.balanceOf(alice.address)).to.be.eq(prevBalance.add(rewardPerBlock))

    const prevBalanceBob = await CRV.balanceOf(bob.address)

    // transfer to bob
    await fix.wrapper
      .connect(alice)
      .transfer(bob.address, await fix.wrapper.balanceOf(alice.address))

    await fix.wrapper.connect(bob).claimRewards()
    expect(await CRV.balanceOf(bob.address)).to.be.eq(prevBalanceBob.add(rewardPerBlock))

    await expect(fix.wrapper.connect(alice).deposit(amount, alice.address)).to.be.reverted
    await expect(fix.wrapper.connect(bob).withdraw(await fix.wrapper.balanceOf(bob.address))).to.not
      .be.reverted
  })
}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  makeCollateralFixtureContext,
  mintCollateralTo,
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it,
  itHasRevenueHiding: it,
  isMetapool: false,
  resetFork,
  collateralName: 'CurveStableCollateral - ConvexStakingWrapper',
}

collateralTests(opts)
