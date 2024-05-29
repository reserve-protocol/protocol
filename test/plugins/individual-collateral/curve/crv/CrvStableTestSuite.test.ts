import collateralTests from '../collateralTests'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { mintWPool, makeW3PoolStable, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../../common/constants'
import { whileImpersonating } from '../../../../utils/impersonation'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  THREE_POOL,
  THREE_POOL_TOKEN,
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
  CurvePoolType,
  CRV,
  THREE_POOL_HOLDER,
  TRI_CRYPTO_TOKEN,
  TRI_CRYPTO_GAUGE,
  TRI_CRYPTO_HOLDER,
} from '../constants'

type Fixture<T> = () => Promise<T>

export const defaultCrvStableCollateralOpts: CurveCollateralOpts = {
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

  opts = { ...defaultCrvStableCollateralOpts, ...opts }

  const CrvStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CurveStableCollateral'
  )

  const collateral = <TestICollateral>await CrvStableCollateralFactory.deploy(
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
  const collateralOpts = { ...defaultCrvStableCollateralOpts, ...opts }

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
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.curvePool,
      wrapper: fix.wrapper,
      rewardTokens: [crv],
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

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('wrapper allows to deposit and withdraw', async () => {
    const [alice] = await ethers.getSigners()

    // Deploy Wrapper
    const wrapperFactory = await ethers.getContractFactory('CurveGaugeWrapper')
    const wrapper = await wrapperFactory.deploy(
      TRI_CRYPTO_TOKEN,
      'Wrapped Curve.fi USD-BTC-ETH',
      'wcrv3crypto',
      CRV,
      TRI_CRYPTO_GAUGE
    )

    const amount = bn('20000').mul(bn(10).pow(await wrapper.decimals()))

    const lpToken = await ethers.getContractAt(
      '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
      await wrapper.underlying()
    )
    await whileImpersonating(TRI_CRYPTO_HOLDER, async (signer) => {
      await lpToken.connect(signer).transfer(alice.address, amount)
    })

    // Initial Balance
    expect(await lpToken.balanceOf(alice.address)).to.equal(amount)

    // Deposit
    await lpToken.connect(alice).approve(wrapper.address, amount)
    await wrapper.connect(alice).deposit(amount, alice.address)
    expect(await lpToken.balanceOf(alice.address)).to.equal(0)

    // Withdraw
    await wrapper.connect(alice).withdraw(amount, alice.address)
    expect(await lpToken.balanceOf(alice.address)).to.equal(amount)
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
  itClaimsRewards: it,
  isMetapool: false,
  resetFork,
  collateralName: 'CurveStableCollateral - CurveGaugeWrapper',
}

collateralTests(opts)
