import collateralTests from './gearBoxCollateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IDieselToken,
  IPoolService,
  USDCMock,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  USDC,
  USDC_WHALE,
  GEARBOX_USDC_POOL_SERVICE,
  USDC_USD_PRICE_FEED,
  dUSDC
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'

/*
  Define interfaces
*/

interface DUsdcCollateralFixtureContext extends CollateralFixtureContext {
  dUsdc: IDieselToken
}


/*
  Define deployment functions
*/

export const defaultDUsdcCollateralOpts: CollateralOpts = {
  erc20: dUSDC,
  targetName: ethers.utils.formatBytes32String('USDC'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDC_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultDUsdcCollateralOpts, ...opts }

  const DUsdcCollateralFixtureContext: ContractFactory = await ethers.getContractFactory(
    'GearBoxFiatCollateral'
  )

  const collateral = <TestICollateral>await DUsdcCollateralFixtureContext.deploy(
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
    GEARBOX_USDC_POOL_SERVICE,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<DUsdcCollateralFixtureContext> => {
  const collateralOpts = { ...defaultDUsdcCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const dUsdc = (await ethers.getContractAt('IDieselToken', dUSDC)) as IDieselToken
    const rewardToken = (await ethers.getContractAt('USDCMock', ZERO_ADDRESS)) as USDCMock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      dUsdc,
      tok: dUsdc,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<DUsdcCollateralFixtureContext> = async (
  ctx: DUsdcCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {

  // Notice: this test does not return the correct bal (18 decimals), it has an imprecision around the 8th decimal
  const usdc = (await ethers.getContractAt('USDCMock', USDC)) as USDCMock
  const poolService = (await ethers.getContractAt('IPoolService', GEARBOX_USDC_POOL_SERVICE)) as IPoolService
  const amountToDeposit = await poolService.fromDiesel(amount)
  await whileImpersonating(USDC_WHALE, async (account) => {
    await usdc.connect(account).approve(poolService.address, amountToDeposit)
   
    await poolService.connect(account).addLiquidity(amountToDeposit, user.address, 0)
  })

}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

const reduceRefPerTok = async (ctx: DUsdcCollateralFixtureContext, pctDecrease: BigNumberish) => {

}

const increaseRefPerTok = async (
  ctx: DUsdcCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {

  const usdc = (await ethers.getContractAt('USDCMock', USDC)) as USDCMock
  const poolService = (await ethers.getContractAt('IPoolService', GEARBOX_USDC_POOL_SERVICE)) as IPoolService
  const balance = await usdc.balanceOf(USDC_WHALE)

  const amountToDeposit = balance.div(20)
  
  await whileImpersonating(USDC_WHALE, async (account) => {
    await usdc.connect(account).approve(poolService.address, amountToDeposit)
   
    await poolService.connect(account).addLiquidity(amountToDeposit, USDC_WHALE, 0)
  })
}

const getExpectedPrice = async (ctx: DUsdcCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(refPerTok)
    .div(fp('1'))
}

/*\

  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}

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
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it.skip,
  resetFork,
  collateralName: 'GearBoxFiatCollateral6Decimals',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
