import collateralTests from '../collateralTests'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../types'
import { resetFork, mintWSTETH } from './helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  ICollateral,
  ISTETH,
  IWSTETH,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  STETH,
  WSTETH,
  ETH_USD_PRICE_FEED,
  STETH_ETH_PRICE_FEED,
  LIDO_ORACLE,
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'
import { expectPrice } from '../../../utils/oracles'

/*
  Define interfaces
*/
interface WSTETHCollateralFixtureContext extends CollateralFixtureContext {
  wsteth: IWSTETH
  targetUnitChainlinkFeed: MockV3Aggregator
}

/*
  Define deployment functions
*/

interface WSTETHCollateralOpts extends CollateralOpts {
  targetUnitChainlinkFeed: string
  targetUnitOracleTimeout: BigNumberish
}

export const defaultWSTETHCollateralOpts: WSTETHCollateralOpts = {
  erc20: WSTETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: STETH_ETH_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  targetUnitChainlinkFeed: ETH_USD_PRICE_FEED,
  targetUnitOracleTimeout: ORACLE_TIMEOUT,
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<ICollateral> => {
  opts = { ...defaultWSTETHCollateralOpts, ...opts }

  const WStEthCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'LidoStakedEthCollateral'
  )

  const collateral = <ICollateral>await WStEthCollateralFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      rewardERC20: opts.rewardERC20,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed,
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout,
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    0,
    opts.targetUnitChainlinkFeed,
    opts.targetUnitOracleTimeout,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()
  return collateral
}

const chainlinkDefaultAnswer = bn('0.97e8')
const chainlinkTargetUnitDefaultAnswer = bn('1800e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<WSTETHCollateralFixtureContext> => {
  const collateralOpts = { ...defaultWSTETHCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    const targetUnitChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkTargetUnitDefaultAnswer)
    )

    collateralOpts.chainlinkFeed = chainlinkFeed.address
    collateralOpts.targetUnitChainlinkFeed = targetUnitChainlinkFeed.address

    const wsteth = (await ethers.getContractAt('IWSTETH', WSTETH)) as IWSTETH
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tokDecimals = await wsteth.decimals()

    return {
      alice,
      collateral,
      chainlinkFeed,
      wsteth,
      tok: wsteth,
      rewardToken,
      tokDecimals,
      targetUnitChainlinkFeed,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<WSTETHCollateralFixtureContext> = async (
  ctx: WSTETHCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWSTETH(ctx.wsteth, user, amount, recipient)
}

// prettier-ignore
const reduceRefPerTok = async (
  ctx: WSTETHCollateralFixtureContext,
  pctDecrease: BigNumberish | undefined
) => {

    const steth = (await ethers.getContractAt('ISTETH', STETH)) as ISTETH
    
     // Decrease wsteth to eth exchange rate so refPerTok decreases
     const [, beaconValidators, beaconBalance] = await steth.getBeaconStat()
     const beaconBalanceLower: BigNumberish =  beaconBalance.sub(beaconBalance.mul(pctDecrease!).div(100))

     // Impersonate Lido Oracle
     await whileImpersonating(LIDO_ORACLE, async (lidoSigner) => {
       await steth.connect(lidoSigner).handleOracleReport(beaconValidators, beaconBalanceLower)
     })
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: WSTETHCollateralFixtureContext,
  pctIncrease: BigNumberish | undefined
) => {
    const steth = (await ethers.getContractAt('ISTETH', STETH)) as ISTETH
  
    // Increase wsteth to steth exchange rate so refPerTok increases
    const [, beaconValidators, beaconBalance] = await steth.getBeaconStat()
    const beaconBalanceHigher: BigNumberish = beaconBalance.add(beaconBalance.mul(pctIncrease!).div(100))
   
    // Impersonate Lido Oracle
    await whileImpersonating(LIDO_ORACLE, async (lidoSigner) => {
      await steth.connect(lidoSigner).handleOracleReport(beaconValidators, beaconBalanceHigher)
    })
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  it('does not allow missing target unit chainlink feed', async () => {
    await expect(
      deployCollateral({ targetUnitChainlinkFeed: ethers.constants.AddressZero })
    ).to.be.revertedWith('missing targetUnit feed')
  })

  it('does not allow oracle timeout at 0', async () => {
    await expect(deployCollateral({ targetUnitOracleTimeout: 0 })).to.be.revertedWith(
      'targetUnitOracleTimeout zero'
    )
  })
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  let ctx: WSTETHCollateralFixtureContext
  let chainlinkFeed: MockV3Aggregator
  let targetUnitChainlinkFeed: MockV3Aggregator
  let collateral: ICollateral

  beforeEach(async () => {
    const [, alice] = await ethers.getSigners()
    ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
    ;({ collateral, chainlinkFeed, targetUnitChainlinkFeed } = ctx)
  })

  it('prices change as feeds prices change', async () => {
    // Peg Feed
    const clData = await chainlinkFeed.latestRoundData()
    const clDecimals = await chainlinkFeed.decimals()

    // Target Unit Feed
    const tgtClData = await targetUnitChainlinkFeed.latestRoundData()
    const tgtClDecimals = await targetUnitChainlinkFeed.decimals()

    const oracleError = await collateral.oracleError()
    const refPerTok = await collateral.refPerTok()
    const expectedPegPrice = clData.answer.mul(bn(10).pow(18 - clDecimals))
    const expectedTgtPrice = tgtClData.answer.mul(bn(10).pow(18 - tgtClDecimals))
    const expectedPrice = expectedPegPrice
      .mul(expectedTgtPrice)
      .mul(refPerTok)
      .div(fp('1'))
      .div(fp('1'))

    // Check initial prices
    await expectPrice(collateral.address, expectedPrice, oracleError, true)

    // Get refPerTok initial values
    const initialRefPerTok = await collateral.refPerTok()

    // Update values in Oracles increase by 10-20%
    const newPrice = BigNumber.from(chainlinkDefaultAnswer).mul(11).div(10)
    const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
    await updateAnswerTx.wait()

    // Check new prices
    const newclData = await chainlinkFeed.latestRoundData()
    const newRefPerTok = await collateral.refPerTok()
    const newExpectedPegPrice = newclData.answer.mul(bn(10).pow(18 - clDecimals))
    const newExpectedPrice = newExpectedPegPrice
      .mul(expectedTgtPrice)
      .mul(newRefPerTok)
      .div(fp('1'))
      .div(fp('1'))

    // Price should have increased
    expect(newExpectedPrice).to.be.gt(expectedPrice)

    // Check prices
    await expectPrice(collateral.address, newExpectedPrice, oracleError, true)

    // Check refPerTok remains the same
    const finalRefPerTok = await collateral.refPerTok()
    expect(finalRefPerTok).to.equal(initialRefPerTok)

    // Update the other oracle (Target unit ETH/USD)
    // Increase by 10-20%
    const newTgtPrice = BigNumber.from(chainlinkTargetUnitDefaultAnswer).mul(11).div(10)
    const updateTgtAnswerTx = await targetUnitChainlinkFeed.updateAnswer(newTgtPrice)
    await updateTgtAnswerTx.wait()

    // Check prices were updated
    const newtgtClData = await targetUnitChainlinkFeed.latestRoundData()
    const newExpectedTgtPrice = newtgtClData.answer.mul(bn(10).pow(18 - tgtClDecimals))
    const finalExpectedPrice = newExpectedPegPrice
      .mul(newExpectedTgtPrice)
      .mul(newRefPerTok)
      .div(fp('1'))
      .div(fp('1'))

    // Price should have increased
    expect(finalExpectedPrice).to.be.gt(newExpectedPrice)

    // Check prices
    await expectPrice(collateral.address, finalExpectedPrice, oracleError, true)

    // Check refPerTok remains the same
    expect(await collateral.refPerTok()).to.equal(finalRefPerTok)
  })

  it('prices change as refPerTok changes', async () => {
    // Peg Feed
    const clData = await chainlinkFeed.latestRoundData()
    const clDecimals = await chainlinkFeed.decimals()

    // Target Unit Feed
    const tgtClData = await targetUnitChainlinkFeed.latestRoundData()
    const tgtClDecimals = await targetUnitChainlinkFeed.decimals()

    const oracleError = await collateral.oracleError()

    const initRefPerTok = await collateral.refPerTok()

    const expectedPegPrice = clData.answer.mul(bn(10).pow(18 - clDecimals))
    const expectedTgtPrice = tgtClData.answer.mul(bn(10).pow(18 - tgtClDecimals))
    const expectedPrice = expectedPegPrice
      .mul(expectedTgtPrice)
      .mul(initRefPerTok)
      .div(fp('1'))
      .div(fp('1'))

    // Check initial prices
    await expectPrice(collateral.address, expectedPrice, oracleError, true)

    // Increase refPerTok
    await increaseRefPerTok(ctx, 5)

    await collateral.refresh()
    const newRefPerTok = await collateral.refPerTok()
    expect(newRefPerTok).to.be.gt(initRefPerTok)

    const newExpectedPrice = expectedPegPrice
      .mul(expectedTgtPrice)
      .mul(newRefPerTok)
      .div(fp('1'))
      .div(fp('1'))

    // Price should have increased
    expect(newExpectedPrice).to.be.gt(expectedPrice)

    // Check prices
    await expectPrice(collateral.address, newExpectedPrice, oracleError, true)
  })
}

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
  reduceRefPerTok,
  increaseRefPerTok,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it,
  itCheckPriceChanges: it.skip,
  itChecksRefPerTokDefault: it,
  resetFork,
  collateralName: 'LidoStakedETH',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
