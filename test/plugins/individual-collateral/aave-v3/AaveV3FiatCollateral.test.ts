import collateralTests from '../collateralTests'
import { CollateralFixtureContext, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { BigNumberish, BigNumber } from 'ethers'
import {
  TestICollateral,
  AaveV3FiatCollateral__factory,
  IERC20Metadata,
  IStaticATokenLMV3,
} from '@typechain/index'
import { bn, fp } from '#/common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { noop } from 'lodash'
import { PRICE_TIMEOUT } from '#/test/fixtures'
import { networkConfig } from '#/common/configuration'
import { getResetFork } from '../helpers'
import { whileImpersonating } from '#/test/utils/impersonation'
import { setStorageAt } from '@nomicfoundation/hardhat-network-helpers'

interface AaveV3FiatCollateralFixtureContext extends CollateralFixtureContext {
  staticWrapper: IStaticATokenLMV3
  baseToken: IERC20Metadata
}

/*
  Define deployment functions
*/

// This defines options for the Aave V3 USDC Market
export const defaultCollateralOpts: Parameters<AaveV3FiatCollateral__factory['deploy']>[0] = {
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: networkConfig[1].chainlinkFeeds.USDC!,
  oracleError: fp('0.0025'),
  erc20: '0x02c2d189b45CE213a40097b62D311cf0dD16eC92', // StaticATokenLM for USDC
  maxTradeVolume: fp('1e6'),
  oracleTimeout: bn('86400'),
  targetName: ethers.utils.formatBytes32String('USD'),
  defaultThreshold: fp('0.0125'),
  delayUntilDefault: bn('86400'),
}

export const deployCollateral = async (
  opts: Partial<Parameters<AaveV3FiatCollateral__factory['deploy']>[0]> = {}
) => {
  const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')

  const collateral = await CollateralFactory.deploy(
    {
      ...defaultCollateralOpts,
      ...opts,
    },
    fp('0'), // change this to test with revenueHiding
    {
      gasLimit: 30000000,
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  // our tools really suck don't they
  return collateral as unknown as TestICollateral
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts = {}
): Fixture<AaveV3FiatCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const collateral = await deployCollateral({
      ...collateralOpts,
      chainlinkFeed: chainlinkFeed.address,
    })

    const staticWrapper = <IStaticATokenLMV3>(
      await ethers.getContractAt('IStaticATokenLM_V3', collateralOpts.erc20)
    )

    return {
      collateral,
      staticWrapper,
      chainlinkFeed,
      tok: await ethers.getContractAt('IERC20Metadata', collateralOpts.erc20),
      baseToken: await ethers.getContractAt(
        'IERC20Metadata',
        await staticWrapper.aTokenUnderlying()
      ),
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<AaveV3FiatCollateralFixtureContext> = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  const requiredCollat = await ctx.staticWrapper.previewMint(amount)

  // USDC Richie Rich
  await whileImpersonating('0x0A59649758aa4d66E25f08Dd01271e891fe52199', async (signer) => {
    await ctx.baseToken
      .connect(signer)
      .approve(ctx.staticWrapper.address, ethers.constants.MaxUint256)
    await ctx.staticWrapper.connect(signer).deposit(requiredCollat, recipient, 0, true)
  })
}

const modifyRefPerTok = async (ctx: AaveV3FiatCollateralFixtureContext, changeFactor = 100) => {
  // const RAY = ethers.BigNumber.from(10).pow(27)
  const staticWrapper = ctx.staticWrapper

  const aavePool = await staticWrapper.POOL()
  // const poolRate = await staticWrapper.rate()

  // Don't even ask how I got to these slots.
  const storageSlot1 = await ethers.provider.getStorageAt(
    aavePool,
    '0xed960c71bd5fa1333658850f076b35ec5565086b606556c3dd36a916b43ddf21'
  )
  const storageSlot2 = await ethers.provider.getStorageAt(
    aavePool,
    '0xed960c71bd5fa1333658850f076b35ec5565086b606556c3dd36a916b43ddf23'
  )
  // const currentTimestamp = (await ethers.provider.getBlock('latest')).timestamp

  // const currentLiquidityRate = ethers.BigNumber.from(`0x${storageSlot1.slice(-64, -32)}`)
  const liquidityIndex = ethers.BigNumber.from(`0x${storageSlot1.slice(-32)}`)
  // const lastUpdateTimestamp = ethers.BigNumber.from(`0x${storageSlot2.slice(-42, -32)}`)

  // const calculateLinearInterest = currentLiquidityRate
  //   .mul(currentTimestamp - lastUpdateTimestamp.toNumber())
  //   .div(365 * 24 * 60 * 60)
  //   .add(RAY)

  // const finalMult = calculateLinearInterest.mul(liquidityIndex).add(RAY.div(2)).div(RAY)

  // finalMult === poolRate; // this should be true.
  // ^ this code above is just to verify that our math is correct

  await setStorageAt(
    aavePool,
    '0xed960c71bd5fa1333658850f076b35ec5565086b606556c3dd36a916b43ddf21',
    storageSlot1.replace(
      storageSlot1.slice(-32),
      liquidityIndex.mul(changeFactor).div(100).toHexString().slice(2).padStart(32, '0')
    )
  )
  await setStorageAt(
    aavePool,
    '0xed960c71bd5fa1333658850f076b35ec5565086b606556c3dd36a916b43ddf23',
    storageSlot2.replace(storageSlot2.slice(-42, -32), ''.padStart(10, '0'))
  )
}

const reduceRefPerTok = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await modifyRefPerTok(ctx, 100 - Number(pctDecrease.toString()))
}

const increaseRefPerTok = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await modifyRefPerTok(ctx, 100 + Number(pctIncrease.toString()))
}

const getExpectedPrice = async (ctx: AaveV3FiatCollateralFixtureContext): Promise<BigNumber> => {
  const initRefPerTok = await ctx.collateral.refPerTok()
  const decimals = await ctx.chainlinkFeed.decimals()

  const initData = await ctx.chainlinkFeed.latestRoundData()
  return initData.answer
    .mul(bn(10).pow(18 - decimals))
    .mul(initRefPerTok)
    .div(fp('1'))
}

const reduceTargetPerRef = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))

  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (
  ctx: AaveV3FiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))

  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

/*
  Run the test suite
*/

export const stableOpts = {
  deployCollateral,
  collateralSpecificConstructorTests: noop,
  collateralSpecificStatusTests: noop,
  beforeEachRewardsTest: noop,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceRefPerTok,
  increaseRefPerTok,
  resetFork: getResetFork(18000000),
  collateralName: 'Aave V3 Fiat Collateral (USDC)',
  reduceTargetPerRef,
  increaseTargetPerRef,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it.skip, // we are modifying storage for refPerTok, supply check fails
  itHasRevenueHiding: it.skip, // enable revenueHiding in constructor, or everything else fails
  itIsPricedByPeg: true,
  chainlinkDefaultAnswer: 1e8,
  itChecksPriceChanges: it,
  getExpectedPrice,
}

collateralTests(stableOpts)
