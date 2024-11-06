import collateralTests from '../curve/collateralTests'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../curve/pluginTestTypes'
import { mintYToken, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import {
  CurveMetapoolMock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { bn } from '../../../../common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  crvUSD,
  CRV_USD_USD_FEED,
  CRV_USD_ORACLE_TIMEOUT,
  CRV_USD_ORACLE_ERROR,
  PRICE_PER_SHARE_HELPER,
  USDP,
  USDP_USD_FEED,
  USDP_ORACLE_TIMEOUT,
  USDP_ORACLE_ERROR,
  yvCurveUSDCcrvUSD,
  yvCurveUSDPcrvUSD,
  YVUSDC_LP_TOKEN,
  YVUSDP_LP_TOKEN,
} from './constants'
import {
  PRICE_TIMEOUT,
  USDC,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
} from '../curve/constants'
import { setStorageAt } from '@nomicfoundation/hardhat-network-helpers'

// Note: Uses ../curve/collateralTests.ts, not ../collateralTests.ts

type Fixture<T> = () => Promise<T>

type CurveFiatTest = {
  name: string // name of the test
  yToken: string // address of the yToken
  lpToken: string // address of the lpToken
  pairedToken: string // address of the paired token
  pairedOracle: string // address of the oracle for the non-crvUSD token
  pairedOracleTimeout: BigNumber // oracleTimeout for the non-crvUSD token's oracle
  pairedOracleError: BigNumber // oracleError for the non-crvUSD token's oracle
}

const tests = [
  {
    name: 'yvCurveUSDCcrvUSD',
    yToken: yvCurveUSDCcrvUSD,
    lpToken: YVUSDC_LP_TOKEN,
    pairedToken: USDC,
    pairedOracle: USDC_USD_FEED,
    pairedOracleTimeout: USDC_ORACLE_TIMEOUT,
    pairedOracleError: USDC_ORACLE_ERROR,
  },
  {
    name: 'yvCurveUSDPcrvUSD',
    yToken: yvCurveUSDPcrvUSD,
    lpToken: YVUSDP_LP_TOKEN,
    pairedToken: USDP,
    pairedOracle: USDP_USD_FEED,
    pairedOracleTimeout: USDP_ORACLE_TIMEOUT,
    pairedOracleError: USDP_ORACLE_ERROR,
  },
]

tests.forEach((test: CurveFiatTest) => {
  const defaultCrvStableCollateralOpts: CurveCollateralOpts = {
    erc20: test.yToken,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: test.pairedOracle, // unused but cannot be zero
    oracleTimeout: test.pairedOracleTimeout.gt(CRV_USD_ORACLE_TIMEOUT)
      ? test.pairedOracleTimeout
      : CRV_USD_ORACLE_TIMEOUT, // max of oracleTimeouts
    oracleError: bn('1'), // unused but cannot be zero
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    revenueHiding: bn('0'),
    nTokens: 2,
    lpToken: test.lpToken,
    curvePool: test.lpToken,
    poolType: CurvePoolType.Plain,
    feeds: [[test.pairedOracle], [CRV_USD_USD_FEED]],
    oracleTimeouts: [[test.pairedOracleTimeout], [CRV_USD_ORACLE_TIMEOUT]],
    oracleErrors: [[test.pairedOracleError], [CRV_USD_ORACLE_ERROR]],
  }

  const deployCollateral = async (
    opts: CurveCollateralOpts = {}
  ): Promise<[TestICollateral, CurveCollateralOpts]> => {
    if (!opts.erc20 && !opts.feeds) {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      // Substitute both feeds: test.pairedToken + crvUSD
      const pairedTokenFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      const crvUsdFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      opts.feeds = [[pairedTokenFeed.address], [crvUsdFeed.address]]
    }

    opts = { ...defaultCrvStableCollateralOpts, ...opts }

    const YearnV2CurveFiatCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'YearnV2CurveFiatCollateral'
    )

    const collateral = <TestICollateral>await YearnV2CurveFiatCollateralFactory.deploy(
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
      },
      PRICE_PER_SHARE_HELPER
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
    const collateralOpts = { ...defaultCrvStableCollateralOpts, ...opts }

    const makeCollateralFixtureContext = async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      // Substitute both feeds: test.pairedToken + crvUSD
      const pairedTokenFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      const crvUsdFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      collateralOpts.feeds = [[pairedTokenFeed.address], [crvUsdFeed.address]]

      const pairedToken = await ethers.getContractAt('ERC20Mock', test.pairedToken)
      const crvUsdToken = await ethers.getContractAt('ERC20Mock', crvUSD)
      const wrapper = await ethers.getContractAt('ConvexStakingWrapper', test.yToken) // not really a ConvexStakingWrapper

      // Use mock curvePool seeded with initial balances
      const CurvePoolMockFactory = await ethers.getContractFactory('CurveMetapoolMock') // not a metapool, but this works
      const realCurvePool = <CurveMetapoolMock>(
        await ethers.getContractAt('CurveMetapoolMock', test.lpToken)
      )
      const curvePool = <CurveMetapoolMock>(
        await CurvePoolMockFactory.deploy(
          [await realCurvePool.balances(0), await realCurvePool.balances(1)],
          [await realCurvePool.coins(0), await realCurvePool.coins(1)]
        )
      )
      await curvePool.setVirtualPrice(await realCurvePool.get_virtual_price())
      await curvePool.mint(alice.address, await realCurvePool.totalSupply())
      collateralOpts.lpToken = curvePool.address
      collateralOpts.curvePool = curvePool.address

      const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
      return {
        alice,
        collateral,
        wrapper,
        curvePool,
        rewardTokens: [],
        poolTokens: [pairedToken, crvUsdToken],
        feeds: [pairedTokenFeed, crvUsdFeed],
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
    await mintYToken(ctx.wrapper.address, amount, recipient)
  }

  /*
  Define collateral-specific tests
  */

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificConstructorTests = () => {}

  const collateralSpecificStatusTests = () => {
    it('correctly values tokens', async () => {
      const [collateral] = await deployCollateral()

      await collateral.refresh()
      const refPerTokBefore = await collateral.refPerTok()

      const slotValue = await ethers.provider.getStorageAt(await collateral.erc20(), 0x28)
      await setStorageAt(
        await collateral.erc20(),
        0x28,
        BigNumber.from(slotValue).mul(101).div(100).toHexString() // increase debt by 1%
      )

      await collateral.refresh()
      const refPerTokAfter = await collateral.refPerTok()

      expect(refPerTokAfter).to.be.gt(refPerTokBefore)
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
    itChecksTargetPerRefDefaultUp: it,
    itChecksRefPerTokDefault: it,
    itHasRevenueHiding: it,
    itClaimsRewards: it.skip,
    isMetapool: false,
    resetFork,
    collateralName: 'YearnV2CurveFiatCollateral -- ' + test.name,
  }

  collateralTests(opts)
})
