import collateralTests from '../collateralTests'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { bn } from '../../../../common/numbers'
import {
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IMaplePool,
} from '../../../../typechain'
import { CollateralOpts, CollateralFixtureContext } from '../pluginTestTypes'
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
  MAPLE_USDC_POOL,
  USDC_HOLDER,
  MPL_mcUSDC2_HOLDER,
  USDC_TOKEN,
  USDC_TO_USD_PRICE_FEED,
  USDC_TO_USD_PRICE_ERROR,
  PRICE_TIMEOUT,
  ORACLE_TIMEOUT,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  REVENUE_HIDING,
} from './constants'

// default parameters

const defaultCollateralOpts: CollateralOpts = {
  erc20: MAPLE_USDC_POOL,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDC_TO_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: USDC_TO_USD_PRICE_ERROR,
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

  const _MaplePoolFiatCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'MaplePoolFiatCollateral'
  )

  const _collateral = <TestICollateral>await _MaplePoolFiatCollateralFactory.deploy(
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
  await transferMaplePoolToken(MPL_mcUSDC2_HOLDER, ctx.tok as IMaplePool, amount, recipient)
}

// Specific tests factory

const collateralSpecificStatusTests = emptyFn

const collateralSpecificConstructorTests = emptyFn

const beforeEachRewardsTest = emptyFn

// Run the test suite

const opts = {
  deployCollateral: deployCollateral,
  collateralSpecificConstructorTests: collateralSpecificConstructorTests,
  collateralSpecificStatusTests: collateralSpecificStatusTests,
  beforeEachRewardsTest: beforeEachRewardsTest,
  makeCollateralFixtureContext: makeMakeCollateralFixtureContext,
  mintCollateralTo: mintCollateralTo,
  reduceTargetPerRef: reduceTargetPerRef,
  increaseTargetPerRef: increaseTargetPerRef,
  reduceRefPerTok: reduceRefPerTokFactory(USDC_TOKEN, USDC_HOLDER, 0),
  increaseRefPerTok: increaseRefPerTokFactory(USDC_TOKEN, USDC_HOLDER),
  getExpectedPrice: getExpectedPrice,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it,
  itIsPricedByPeg: true,
  resetFork: resetFork,
  collateralName: 'Maple USDC Collateral',
  chainlinkDefaultAnswer: bn('1e8'), // 8 decimals,
}

collateralTests(opts)
