import collateralTests from '../collateralTests'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator, MockV3Aggregator__factory, TestICollateral, IMaplePool, MaplePoolMock } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { advanceBlocks } from '../../../utils/time'
import { CollateralFixtureContext, CollateralStatus, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintMaplePoolToken } from './helpers'
import {
  MAPLE_USDC_POOL,
  MAPLE_WETH_POOL,
  USDC_HOLDER,
  WETH_HOLDER,
  USDC_TOKEN,
  WETH_TOKEN,
  USDC_PRICE_FEED,
  ETH_PRICE_FEED,
  USDC_PRICE_ERROR,
  WETH_PRICE_ERROR,
  PRICE_TIMEOUT,
  ORACLE_TIMEOUT,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  REVENUE_HIDING,
} from './constants'

// Iterate over both USDC and wETH MaplePool tokens

interface MaplePoolTokenEnumeration {
  testName: string
  tokenName: string
  underlying: string
  holder: string
  MaplePoolToken: string
  chainlinkFeed: string
  oracleError: BigNumberish
  defaultOraclePrice: BigNumberish
}

const all = [
  {
    testName: 'Maple USDC Collateral',
    tokenName: 'MPL-mcUSDC2',
    underlying: USDC_TOKEN,
    holder: USDC_HOLDER,
    MaplePoolToken: MAPLE_USDC_POOL,
    oracleError: USDC_PRICE_ERROR,
    chainlinkFeed: USDC_PRICE_FEED, // {target/ref}
    defaultOraclePrice: bn('1e8'), // 8 decimals
  },
  {
    testName: 'Maple wETH Collateral',
    tokenName: 'MPL-mcWETH1',
    underlying: WETH_TOKEN,
    holder: WETH_HOLDER,
    MaplePoolToken: MAPLE_WETH_POOL,
    oracleError: WETH_PRICE_ERROR,
    chainlinkFeed: ETH_PRICE_FEED, // {target/ref}
    defaultOraclePrice: bn('1800e8'), // 8 decimals
  },
]
all.forEach((current: MaplePoolTokenEnumeration) => {
  const defaultCollateralOpts: CollateralOpts = {
    erc20: current.MaplePoolToken,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: current.chainlinkFeed,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: current.oracleError,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    revenueHiding: REVENUE_HIDING,
  }

  const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    const MaplePoolCollateralFactory: ContractFactory = await ethers.getContractFactory('MaplePoolCollateral')

    const collateral = <TestICollateral>await MaplePoolCollateralFactory.deploy(
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

    // sometimes we are trying to test a negative test case and we want this to fail silently
    // fortunately this syntax fails silently because our tools are terrible
    await expect(collateral.refresh())

    return collateral
  }

  type Fixture<T> = () => Promise<T>

  const makeCollateralFixtureContext = (alice: SignerWithAddress, opts: CollateralOpts = {}): Fixture<CollateralFixtureContext> => {
    const collateralOpts = { ...defaultCollateralOpts, ...opts }

    const _makeCollateralFixtureContext = async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(await ethers.getContractFactory('MockV3Aggregator'))

      const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, current.defaultOraclePrice)
      collateralOpts.chainlinkFeed = chainlinkFeed.address

      const collateral = await deployCollateral(collateralOpts)
      const erc20 = await ethers.getContractAt('IMaplePool', collateralOpts.erc20 as string) // the Maple pool

      return {
        alice,
        collateral,
        chainlinkFeed,
        tok: erc20,
      }
    }

    return _makeCollateralFixtureContext
  }

  const deployCollateralMockContext = async (opts: CollateralOpts = {}): Promise<CollateralFixtureContext> => {
    const collateralOpts = { ...defaultCollateralOpts, ...opts }

    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(await ethers.getContractFactory('MockV3Aggregator'))

    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, current.defaultOraclePrice)
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const MaplePoolMockFactory = await ethers.getContractFactory('MaplePoolMock')
    const erc20 = await MaplePoolMockFactory.deploy('Mock MaplePool', 'Mock '.concat(current.tokenName))
    collateralOpts.erc20 = erc20.address // ?? side effect ?

    const collateral = await deployCollateral(collateralOpts)

    return {
      collateral,
      chainlinkFeed,
      tok: erc20,
    }
  }

  // helpers

  const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
    ctx: CollateralFixtureContext,
    amount: BigNumberish,
    user: SignerWithAddress,
    recipient: string
  ) => {
    const tok = ctx.tok as IMaplePool
    const underlying = await ethers.getContractAt('IERC20Metadata', current.underlying)
    await mintMaplePoolToken(underlying, current.holder, tok, amount, recipient)
  }

  const increaseRefPerTok = async (ctx: CollateralFixtureContext) => {
    await advanceBlocks(1)
    await (ctx.tok as IMaplePool).convertToAssets(1e18)
  }

  const collateralSpecificConstructorTests = () => {
    return
  }

  const collateralSpecificStatusTests = () => {
    it('does revenue hiding correctly', async () => {
      const { collateral, tok } = await deployCollateralMockContext({ revenueHiding: fp('0.01') })

      // the exposed refPerTok is 0.99 the max (here current) refPerTok
      await (tok as MaplePoolMock).setRefPerTok(fp('2')) // twice the default rpt
      await collateral.refresh() // refresh actually updates the rpt
      const before = await collateral.refPerTok()
      expect(before).to.equal(fp('1.98'))
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

      // Should be SOUND if drops just under 1%
      await (tok as MaplePoolMock).setRefPerTok(fp('1.98001'))
      await collateral.refresh()
      let after = await collateral.refPerTok()
      expect(before).to.eq(after)
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

      // Should be DISABLED if drops just over 1%
      await (tok as MaplePoolMock).setRefPerTok(fp('1.97999'))
      await collateral.refresh()
      after = await collateral.refPerTok()
      expect(before).to.be.gt(after)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  }

  const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const initRefPerTok = await ctx.collateral.refPerTok()

    const decimals = await ctx.chainlinkFeed.decimals()

    const initData = await ctx.chainlinkFeed.latestRoundData()
    return initData.answer
      .mul(bn(10).pow(18 - decimals))
      .mul(initRefPerTok)
      .div(fp('1'))
  }

  // Run the test suite

  const emptyFn = () => {
    return
  }

  const opts = {
    deployCollateral,
    collateralSpecificConstructorTests: collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    beforeEachRewardsTest: emptyFn,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceTargetPerRef: emptyFn,
    increaseTargetPerRef: emptyFn,
    reduceRefPerTok: emptyFn,
    increaseRefPerTok,
    getExpectedPrice,
    itClaimsRewards: it.skip,
    itChecksTargetPerRefDefault: it.skip,
    itChecksRefPerTokDefault: it.skip,
    itChecksPriceChanges: it,
    itHasRevenueHiding: it.skip, // in this file
    resetFork,
    collateralName: current.testName,
    chainlinkDefaultAnswer: bn('1e8'),
  }

  collateralTests(opts)
})
