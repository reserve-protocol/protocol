import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork } from './helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import {
  IStargatePool, StargatePoolMock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  SGETH,
  USDC,
  USDT,
  STG_USDC_POOL,
  STG_WETH_POOL,
  STG_USDT_POOL,
  USDC_USD_PRICE_FEED,
  REVENUE_HIDING
} from './constants'

const defaultSTGUSDCCollateralOpts: CollateralOpts = {
  erc20: STG_USDC_POOL,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDC_USD_PRICE_FEED, // meant for {target/ref} ({ETH/wETH} = 1 here) but used for {uoa/target} ({USD/ETH}); gives the right price in getExpectedPrice
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,
}
type Fixture<T> = () => Promise<T>
export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultSTGUSDCCollateralOpts, ...opts }

  const StargatePoolCollateralFactory: ContractFactory = await ethers.getContractFactory('StargatePoolCollateral')

  const collateral = <TestICollateral>await StargatePoolCollateralFactory.deploy(
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

const emptyFn = () => {return}
// Collateral fixture factory


const makeMakeCollateralFixtureContext = (alice: SignerWithAddress, opts: CollateralOpts = {}): Fixture<CollateralFixtureContext> => {
  const _opts = { ...defaultSTGUSDCCollateralOpts, ...opts }

  const _makeCollateralFixtureContext = async () => {
      const _mockV3AggregatorFactory = <MockV3Aggregator__factory>(await ethers.getContractFactory('MockV3Aggregator'))
      const _chainlinkFeed = <MockV3Aggregator>await _mockV3AggregatorFactory.deploy(8, bn('1e8'))
      _opts.chainlinkFeed = _chainlinkFeed.address

      const _collateral = await deployCollateral(_opts)
      const _erc20 = await ethers.getContractAt('IStargatePool', _opts.erc20 as string) 

      return {
          alice: alice,
          collateral: _collateral,
          chainlinkFeed: _chainlinkFeed,
          tok: _erc20,
      }
  }

  return _makeCollateralFixtureContext
}

// Mock collateral fixture factory

const _deployCollateralMockContext = async (opts: CollateralOpts = {}): Promise<CollateralFixtureContext> => {
  const _opts = { ...defaultSTGUSDCCollateralOpts, ...opts }

  const _mockV3AggregatorFactory = <MockV3Aggregator__factory>(await ethers.getContractFactory('MockV3Aggregator'))

  const _chainlinkFeed = <MockV3Aggregator>await _mockV3AggregatorFactory.deploy(8, bn('1e8'))
  _opts.chainlinkFeed = _chainlinkFeed.address

  const _stgtokenMockFactory = await ethers.getContractFactory('ERC20Mock')
  const _erc20 = await _stgtokenMockFactory.deploy('Stargate Mock', 'Mock S*USDC')
  _opts.erc20 = _erc20.address

  const _collateral = await deployCollateral(_opts)

  return {
      collateral: _collateral,
      chainlinkFeed: _chainlinkFeed,
      tok: _erc20,
  }
}

// Maple token minting factory

const mintCollateralTo = async (ctx: CollateralFixtureContext, amount: BigNumberish, user: SignerWithAddress, recipient: string) => {
  // await transferMaplePoolToken(MPL_mcWETH1_HOLDER, (ctx.tok as IMaplePool), amount, recipient)
}

// Specific tests factory

const collateralSpecificStatusTests = () => {
  it('does revenue hiding correctly', async () => {

  })
}

// prettier-ignore
const reduceRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctDecrease: BigNumberish 
) => {

}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctIncrease: BigNumberish 
) => {
}

export const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
  const totalLiquidity = await (ctx.tok as IStargatePool).totalLiquidity();
  const totalSupply = await (ctx.tok as IStargatePool).totalSupply();
  const _refPerTok = fp(totalLiquidity).div(fp(totalSupply));
  const _decimals = await ctx.chainlinkFeed.decimals()
  const _targetPerRef = await ctx.chainlinkFeed.latestRoundData()

  return _targetPerRef.answer.mul(bn(10).pow(18 - _decimals)).mul(_refPerTok).div(fp('1'))
}

// Run the test suite

const opts = {
  deployCollateral: deployCollateral,
  collateralSpecificConstructorTests: emptyFn,
  collateralSpecificStatusTests, 
  beforeEachRewardsTest: emptyFn,
  makeCollateralFixtureContext: makeMakeCollateralFixtureContext,
  mintCollateralTo: mintCollateralTo,
  reduceTargetPerRef: emptyFn,
  increaseTargetPerRef: emptyFn,
  reduceRefPerTok,
  increaseRefPerTok,
  getExpectedPrice,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it.skip, // the collateral doesn't use the {target/ref} feed
  itHasRevenueHiding: it.skip, // done in collateralSpecificStatusTests
  itIsPricedByPeg: false,
  resetFork: resetFork,
  collateralName: 'STG USDC Collateral',
  chainlinkDefaultAnswer: bn('1e8'), // 8 decimals,
}

collateralTests(opts)