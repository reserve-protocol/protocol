import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { mintW3Pool, makeW3Pool, Wrapped3PoolFixture, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  THREE_POOL,
  THREE_POOL_TOKEN,
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
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
} from './constants'

type Fixture<T> = () => Promise<T>

/*
  Define interfaces
*/

interface CvxStableCollateralFixtureContext extends CollateralFixtureContext, Wrapped3PoolFixture {}

// interface CometCollateralFixtureContextMockComet extends CollateralFixtureContext {
//   cusdcV3: CometMock
//   wcusdcV3: ICusdcV3Wrapper
//   usdc: ERC20Mock
//   wcusdcV3Mock: CusdcV3WrapperMock
// }

enum CurvePoolType {
  Plain,
  Lending,
  Metapool,
}

interface CvxStableCollateralOpts extends CollateralOpts {
  revenueHiding?: BigNumberish
  nTokens?: BigNumberish
  curvePool?: string
  poolType?: CurvePoolType
  feeds?: string[][]
  oracleTimeouts?: BigNumberish[][]
  oracleErrors?: BigNumberish[][]
}

/*
  Define deployment functions
*/

export const defaultCvxStableCollateralOpts: CvxStableCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: DAI_USD_FEED, // unused but cannot be zero
  oracleTimeout: bn('1'), // unused but cannot be zero
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'), // TODO
  nTokens: bn('3'),
  curvePool: THREE_POOL,
  poolType: CurvePoolType.Plain,
  feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
  oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
  oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
}

export const deployCollateral = async (
  opts: CvxStableCollateralOpts = {},
  allowOverride = false
): Promise<TestICollateral> => {
  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CvxStableCollateral'
  )

  if (allowOverride && opts.erc20 === ZERO_ADDRESS) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeW3Pool()

    opts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]
    opts.erc20 = fix.w3Pool.address
  }

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
    }
  )
  await collateral.deployed()

  return collateral
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CvxStableCollateralOpts = {}
): Fixture<CvxStableCollateralFixtureContext> => {
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

    const fix = await makeW3Pool()
    // TODO should anything else be replaced with mocks?

    collateralOpts.erc20 = fix.w3Pool.address
    const collateral = await deployCollateral(collateralOpts)
    const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX) // use CVX
    const tokDecimals = await fix.w3Pool.decimals()

    return {
      alice,
      collateral,
      chainlinkFeed: daiFeed,
      curvePool: fix.curvePool,
      crv3Pool: fix.crv3Pool,
      cvx3Pool: fix.cvx3Pool,
      w3Pool: fix.w3Pool,
      dai: fix.dai,
      usdc: fix.usdc,
      usdt: fix.usdt,
      tok: fix.w3Pool,
      rewardToken,
      tokDecimals,
    }
  }

  return makeCollateralFixtureContext
}

// const deployCollateralCometMockContext = async (
//   opts: CvxStableCollateralOpts = {}
// ): Promise<CometCollateralFixtureContextMockComet> => {
//   const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

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
//   const tokDecimals = await wcusdcV3.decimals()

//   return {
//     collateral,
//     chainlinkFeed,
//     cusdcV3,
//     wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
//     wcusdcV3Mock,
//     usdc,
//     tok: wcusdcV3,
//     rewardToken,
//     tokDecimals,
//   }
// }

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<CvxStableCollateralFixtureContext> = async (
  ctx: CvxStableCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintW3Pool(ctx, amount, user, recipient)
}

const reduceRefPerTok = async (ctx: CvxStableCollateralFixtureContext) => {
  const currentExchangeRate = await ctx.curvePool.get_virtual_price()
  await ctx.curvePool.setVirtualPrice(currentExchangeRate.sub(100))
}

/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {
  it('does not allow 0 defaultThreshold', async () => {
    await expect(deployCollateral({ defaultThreshold: bn('0') })).to.be.revertedWith(
      'defaultThreshold zero'
    )
  })

  it('does not allow more than 4 tokens', async () => {
    await expect(deployCollateral({ nTokens: 5 })).to.be.revertedWith('up to 4 tokens max')
  })

  it('does not allow empty curvePool', async () => {
    await expect(deployCollateral({ curvePool: ZERO_ADDRESS })).to.be.revertedWith(
      'curvePool address is zero'
    )
  })

  it('does not allow more than 2 price feeds', async () => {
    await expect(
      deployCollateral({ feeds: [[DAI_USD_FEED, DAI_USD_FEED, DAI_USD_FEED], [], []] })
    ).to.be.revertedWith('price feeds limited to 2')
  })

  it('requires at least 1 price feed per token', async () => {
    await expect(
      deployCollateral({ feeds: [[DAI_USD_FEED, DAI_USD_FEED], [USDC_USD_FEED], []] })
    ).to.be.revertedWith('each token needs at least 1 price feed')
  })

  it('requires non-zero-address feeds', async () => {
    await expect(
      deployCollateral({ feeds: [[ZERO_ADDRESS], [USDC_USD_FEED], [USDT_USD_FEED]] })
    ).to.be.revertedWith('t0feed0 empty')
    await expect(
      deployCollateral({ feeds: [[DAI_USD_FEED, ZERO_ADDRESS], [USDC_USD_FEED], [USDT_USD_FEED]] })
    ).to.be.revertedWith('t0feed1 empty')
    await expect(
      deployCollateral({ feeds: [[USDC_USD_FEED], [ZERO_ADDRESS], [USDT_USD_FEED]] })
    ).to.be.revertedWith('t1feed0 empty')
    await expect(
      deployCollateral({ feeds: [[DAI_USD_FEED], [USDC_USD_FEED, ZERO_ADDRESS], [USDT_USD_FEED]] })
    ).to.be.revertedWith('t1feed1 empty')
    await expect(
      deployCollateral({ feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [ZERO_ADDRESS]] })
    ).to.be.revertedWith('t2feed0 empty')
    await expect(
      deployCollateral({ feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED, ZERO_ADDRESS]] })
    ).to.be.revertedWith('t2feed1 empty')
  })

  it('requires non-zero oracleTimeouts', async () => {
    await expect(
      deployCollateral({
        oracleTimeouts: [[bn('0')], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t0timeout0 zero')
    await expect(
      deployCollateral({
        oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [bn('0')], [USDT_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t1timeout0 zero')
    await expect(
      deployCollateral({ oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [bn('0')]] })
    ).to.be.revertedWith('t2timeout0 zero')
  })

  it('requires non-zero oracleErrors', async () => {
    await expect(
      deployCollateral({
        oracleErrors: [[fp('1')], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t0error0 too large')
    await expect(
      deployCollateral({
        oracleErrors: [[USDC_ORACLE_ERROR], [fp('1')], [USDT_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t1error0 too large')
    await expect(
      deployCollateral({ oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [fp('1')]] })
    ).to.be.revertedWith('t2error0 too large')
  })
}

const collateralSpecificStatusTests = () => {
  // // TODO
  //   it('enters IFFY state when compound reserves are below target reserves iffy threshold', async () => {
  //     const mockOpts = { reservesThresholdIffy: 5000n, reservesThresholdDisabled: 1000n }
  //     const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)
  //     const delayUntilDefault = await collateral.delayUntilDefault()

  //     // Check initial state
  //     await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
  //     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  //     expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

  //     // cUSDC/Comet's reserves gone down below reservesThresholdIffy
  //     await cusdcV3.setReserves(4000n)

  //     const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
  //     await setNextBlockTimestamp(nextBlockTimestamp)
  //     const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

  //     await expect(collateral.refresh())
  //       .to.emit(collateral, 'CollateralStatusChanged')
  //       .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
  //     expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  //     expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

  //     // Move time forward past delayUntilDefault
  //     await advanceTime(delayUntilDefault)
  //     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

  //     // Nothing changes if attempt to refresh after default for CTokenV3
  //     const prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
  //     await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
  //     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  //     expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
  //   })

  //   it('enters DISABLED state when reserves threshold is at disabled levels', async () => {
  //     const mockOpts = { reservesThresholdDisabled: 1000n }
  //     const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)

  //     // Check initial state
  //     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  //     expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

  //     // cUSDC/Comet's reserves gone down to 19% of target reserves
  //     await cusdcV3.setReserves(900n)

  //     await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
  //     // State remains the same
  //     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  //     expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
  //   })

  //   it('enters DISABLED state if reserves go negative', async () => {
  //     const mockOpts = { reservesThresholdDisabled: 1000n }
  //     const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)

  //     // Check initial state
  //     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  //     expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

  //     // cUSDC/Comet's reserves gone down to -1
  //     await cusdcV3.setReserves(-1)

  //     await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
  //     // State remains the same
  //     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  //     expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
  //   })
  return
}

const beforeEachRewardsTest = async (ctx: CvxStableCollateralFixtureContext) => {
  // TODO
  // await enableRewardsAccrual(ctx.cusdcV3)
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
  reduceRefPerTok,
  itClaimsRewards: it,
  resetFork,
  collateralName: 'Convex3Pool',
}

collateralTests(opts)
