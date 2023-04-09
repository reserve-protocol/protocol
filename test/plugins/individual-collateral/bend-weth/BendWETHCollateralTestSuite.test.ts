import collateralTests from './collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintBendWETH } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IBToken,
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
  BEND,
  BENDWETH,
  ETH_WHALE,
  BENDDAO_WETH_GATEWAY,
  BENDWETH_DATA_PROVIDER,
  BENDWETH_LEND_POOL_ADDRESS_PROVIDER,
  BENDDAO_INCENTIVES_CONTROLLER,
  ETH_USD_PRICE_FEED,
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'

/*
  Define interfaces
*/

interface BendWETHCollateralFixtureContext extends CollateralFixtureContext {
  bendweth: IBToken
}

/*
  Define deployment functions
*/

export const defaultBendWethCollateralOpts: CollateralOpts = {
  erc20: BENDWETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: BEND,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}



export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultBendWethCollateralOpts, ...opts }

  const BendWETHCollateralFixtureContext: ContractFactory = await ethers.getContractFactory(
    'BendWethCollateral'
  )

  const collateral = <TestICollateral>await BendWETHCollateralFixtureContext.deploy(
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
    BENDWETH_DATA_PROVIDER,
    BENDWETH_LEND_POOL_ADDRESS_PROVIDER,
    BENDDAO_INCENTIVES_CONTROLLER,
    BENDWETH,
    BEND,
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
): Fixture<BendWETHCollateralFixtureContext> => {
  const collateralOpts = { ...defaultBendWethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const bendweth = (await ethers.getContractAt('IBToken', BENDWETH)) as IBToken
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      bendweth,
      tok: bendweth,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<BendWETHCollateralFixtureContext> = async (
  ctx: BendWETHCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintBendWETH(ctx.bendweth, user, amount, recipient)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

const reduceRefPerTok = async (ctx: BendWETHCollateralFixtureContext, pctDecrease: BigNumberish) => {}

const increaseRefPerTok = async (
  ctx: BendWETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  // doesn't increase per pct.
  const bendWeth = await ethers.getContractAt(`IBToken`, BENDWETH)

  const totalSupply = await bendWeth.totalSupply()

  const addAmount = (totalSupply.mul(pctIncrease).div(100))

  const bendDaoWethGateway = await ethers.getContractAt(`IWETHGateway`, BENDDAO_WETH_GATEWAY)

  await whileImpersonating(ETH_WHALE, async (EthWhaleSigner) => {
    await bendDaoWethGateway.connect(EthWhaleSigner).depositETH(EthWhaleSigner.address, 0, {value: addAmount})
  })

}

const getExpectedPrice = async (ctx: BendWETHCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(refPerTok)
    .div(fp('1'))
}

/*
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
  itClaimsRewards: it,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it.skip,
  resetFork,
  collateralName: 'BendWETHCollateral',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
