import collateralTests from '../collateralTests'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { bn } from '../../../../common/numbers'
import { CollateralOpts, CollateralFixtureContext } from '../pluginTestTypes'
import {
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IMaplePool,
} from '../../../../typechain'
import {
  resetFork,
  transferMaplePoolToken,
  getExpectedPrice,
  increaseTargetPerRef,
  reduceTargetPerRef,
  increaseRefPerTokFactory,
  reduceRefPerTokFactory,
} from './helpers'
import {
  MAPLE_WETH_POOL,
  WETH_HOLDER,
  MPL_mcWETH1_HOLDER,
  WETH_TOKEN,
  ETH_TO_USD_PRICE_FEED,
  ETH_TO_USD_PRICE_ERROR,
  PRICE_TIMEOUT,
  ORACLE_TIMEOUT,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  REVENUE_HIDING,
} from './constants'

// default parameters

const defaultCollateralOpts: CollateralOpts = {
  erc20: MAPLE_WETH_POOL,
  targetName: ethers.utils.formatBytes32String('ETH'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_TO_USD_PRICE_FEED, // used for {uoa/target} = {USD/ETH}
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ETH_TO_USD_PRICE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,
}

// Generic constants

// eslint-disable-next-line @typescript-eslint/no-empty-function
const emptyFn = () => {}
type Fixture<T> = () => Promise<T>

// Deployment factory

const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  const _opts = { ...defaultCollateralOpts, ...opts }

  const _MaplePoolSelfReferentialCollateralFactory: ContractFactory =
    await ethers.getContractFactory('MaplePoolSelfReferentialCollateral')

  const _collateral = <TestICollateral>await _MaplePoolSelfReferentialCollateralFactory.deploy(
    {
      erc20: _opts.erc20,
      targetName: _opts.targetName,
      priceTimeout: _opts.priceTimeout,
      chainlinkFeed: _opts.chainlinkFeed,
      oracleError: _opts.oracleError,
      oracleTimeout: _opts.oracleTimeout,
      maxTradeVolume: _opts.maxTradeVolume,
      defaultThreshold: _opts.defaultThreshold,
      delayUntilDefault: _opts.delayUntilDefault,
    },
    _opts.revenueHiding,
    { gasLimit: 2000000000 }
  )
  await _collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(_collateral.refresh())

  return _collateral
}

// Collateral fixture factory

const makeMakeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<CollateralFixtureContext> => {
  const _opts = { ...defaultCollateralOpts, ...opts }

  const _makeCollateralFixtureContext = async () => {
    const _mockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )
    const _chainlinkFeed = <MockV3Aggregator>await _mockV3AggregatorFactory.deploy(8, bn('1e8'))
    _opts.chainlinkFeed = _chainlinkFeed.address

    const _collateral = await deployCollateral(_opts)
    const _erc20 = await ethers.getContractAt('IMaplePool', _opts.erc20 as string)

    return {
      alice: alice,
      collateral: _collateral,
      chainlinkFeed: _chainlinkFeed,
      tok: _erc20,
    }
  }

  return _makeCollateralFixtureContext
}

// Maple token minting factory

const mintCollateralTo = async (
  ctx: CollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await transferMaplePoolToken(MPL_mcWETH1_HOLDER, ctx.tok as IMaplePool, amount, recipient)
}

// Specific tests factory

const collateralSpecificStatusTests = emptyFn

const collateralSpecificConstructorTests = emptyFn

const beforeEachRewardsTest = emptyFn

// Run the test suite

const opts = {
  deployCollateral: deployCollateral,
  collateralSpecificConstructorTests: collateralSpecificConstructorTests,
  collateralSpecificStatusTests: collateralSpecificStatusTests, // tests revenue hiding
  beforeEachRewardsTest: beforeEachRewardsTest,
  makeCollateralFixtureContext: makeMakeCollateralFixtureContext,
  mintCollateralTo: mintCollateralTo,
  reduceTargetPerRef: reduceTargetPerRef,
  increaseTargetPerRef: increaseTargetPerRef,
  reduceRefPerTok: reduceRefPerTokFactory(WETH_TOKEN, WETH_HOLDER, 2),
  increaseRefPerTok: increaseRefPerTokFactory(WETH_TOKEN, WETH_HOLDER),
  getExpectedPrice: getExpectedPrice,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it.skip, // the collateral doesn't use the {target/ref} feed
  itHasRevenueHiding: it, // done in collateralSpecificStatusTests
  itIsPricedByPeg: false,
  resetFork: resetFork,
  collateralName: 'Maple wETH Collateral',
  chainlinkDefaultAnswer: bn('1e8'), // 8 decimals,
}

collateralTests(opts)
