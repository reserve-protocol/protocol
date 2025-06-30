import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  IERC20Metadata,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { expectUnpriced, pushOracleForward } from '../../../utils/oracles'
import { bn, fp, toBNDecimals } from '../../../../common/numbers'
import {
  BN_SCALE_FACTOR,
  ONE_ADDRESS,
  ZERO_ADDRESS,
  CollateralStatus,
} from '../../../../common/constants'
import { whileImpersonating } from '../../../utils/impersonation'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

// Constants for Moonwell Morpho USDC
const VAULT_ADDRESS = '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca'
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // Base USDC
const USDC_USD_PRICE_FEED = '0x7e860098f58bbfc8648a4311b374b1d669a2bc6b' // Base USDC/USD
const PRICE_TIMEOUT = bn('604800') // 1 week
const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
const ORACLE_ERROR = fp('0.005') // 0.5%
const DEFAULT_THRESHOLD = ORACLE_ERROR.add(fp('0.01')) // 0.5% + 1%
const DELAY_UNTIL_DEFAULT = bn(86400)
const MAX_TRADE_VOL = bn(1000000) // $1M
const REVENUE_HIDING = fp('0.000001') // 0.0001%

/*
  Define deployment functions
*/

export const defaultMoonwellMorphoUSDCCollateralOpts: CollateralOpts = {
  erc20: VAULT_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDC_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultMoonwellMorphoUSDCCollateralOpts, ...opts }

  const MoonwellMorphoUSDCCollateralFactory: ContractFactory = await ethers.getContractFactory('MoonwellMorphoUSDCCollateral')
  const collateral = <TestICollateral>await MoonwellMorphoUSDCCollateralFactory.deploy(
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

  // Push forward feed
  await pushOracleForward(opts.chainlinkFeed!)

  // Refresh to initialize
  await expect(collateral.refresh()).to.not.be.reverted

  return collateral
}

const chainlinkDefaultAnswer = bn('1e8') // $1.00 USDC

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<CollateralFixtureContext> => {
  const collateralOpts = { ...defaultMoonwellMorphoUSDCCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    // Mock vault for testing
    const MockVaultFactory = await ethers.getContractFactory('MockCToken')
    const mockVault = await MockVaultFactory.deploy()
    await mockVault.deployed()
    collateralOpts.erc20 = mockVault.address

    // Configure mock vault
    await mockVault.setExchangeRate(ethers.utils.parseEther('1.05'))
    await mockVault.setDecimals(8)

    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tok = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())

    return {
      alice,
      collateral,
      chainlinkFeed,
      tok,
      mockVault,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
  ctx: CollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  // Mint mock vault tokens to recipient
  await ctx.mockVault.mint(recipient, amount)
}

const reduceTargetPerRef = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const reduceRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const currentRate = await ctx.mockVault.exchangeRateStored()
  const newRate = currentRate.sub(currentRate.mul(pctDecrease).div(100))
  await ctx.mockVault.setExchangeRate(newRate)
}

const increaseRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const currentRate = await ctx.mockVault.exchangeRateStored()
  const newRate = currentRate.add(currentRate.mul(pctIncrease).div(100))
  await ctx.mockVault.setExchangeRate(newRate)
}

const getExpectedPrice = async (ctx: CollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()
  const exchangeRate = await ctx.mockVault.exchangeRateStored()

  return clData.answer.mul(exchangeRate).div(bn(10).pow(clDecimals))
}

/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {
  it('Should revert if wrong vault address', async function () {
    const MoonwellMorphoUSDCCollateralFactory = await ethers.getContractFactory('MoonwellMorphoUSDCCollateral')
    const collateralConfig = {
      erc20: ethers.constants.AddressZero,
      chainlinkFeed: USDC_USD_PRICE_FEED,
      maxTradeVolume: MAX_TRADE_VOL,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD,
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
      priceTimeout: PRICE_TIMEOUT,
      oracleError: ORACLE_ERROR,
    }
    await expect(
      MoonwellMorphoUSDCCollateralFactory.deploy(collateralConfig, REVENUE_HIDING)
    ).to.be.revertedWith('wrong vault address')
  })

  it('Should revert if defaultThreshold is zero', async function () {
    const MoonwellMorphoUSDCCollateralFactory = await ethers.getContractFactory('MoonwellMorphoUSDCCollateral')
    const collateralConfig = {
      erc20: VAULT_ADDRESS,
      chainlinkFeed: USDC_USD_PRICE_FEED,
      maxTradeVolume: MAX_TRADE_VOL,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: 0,
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
      priceTimeout: PRICE_TIMEOUT,
      oracleError: ORACLE_ERROR,
    }
    await expect(
      MoonwellMorphoUSDCCollateralFactory.deploy(collateralConfig, REVENUE_HIDING)
    ).to.be.revertedWith('defaultThreshold zero')
  })

  it('Should deploy with correct configuration', async function () {
    const collateral = await deployCollateral()
    expect(await collateral.erc20()).to.equal(VAULT_ADDRESS)
    expect(await collateral.chainlinkFeed()).to.equal(USDC_USD_PRICE_FEED)
  })
}

const collateralSpecificStatusTests = () => {
  it('Should handle exchange rate decreases', async function () {
    const ctx = await makeCollateralFixtureContext(this.alice)()
    
    // Set initial exchange rate
    await ctx.mockVault.setExchangeRate(ethers.utils.parseEther('1.05'))
    await ctx.collateral.refresh()
    
    // Decrease exchange rate (simulating loss)
    await ctx.mockVault.setExchangeRate(ethers.utils.parseEther('1.04'))
    await ctx.collateral.refresh()
    
    const status = await ctx.collateral.status()
    expect(status).to.equal(CollateralStatus.DISABLED)
  })

  it('Should handle USDC price deviations', async function () {
    const ctx = await makeCollateralFixtureContext(this.alice)()
    
    // Set USDC price to deviate from $1
    await ctx.chainlinkFeed.updateAnswer(bn('98e6')) // $0.98 (2% below $1)
    await ctx.collateral.refresh()
    
    const status = await ctx.collateral.status()
    expect(status).to.equal(CollateralStatus.IFFY)
  })

  it('Should handle oracle failures gracefully', async function () {
    const ctx = await makeCollateralFixtureContext(this.alice)()
    
    // Set oracle to return stale data
    const staleTimestamp = Math.floor(Date.now() / 1000) - 90000 // 25 hours ago
    await ctx.chainlinkFeed.setTimestamp(staleTimestamp)
    await ctx.collateral.refresh()
    
    const status = await ctx.collateral.status()
    expect(status).to.equal(CollateralStatus.IFFY)
  })
}

const collateralSpecificPriceTests = () => {
  it('Should return correct underlyingRefPerTok', async function () {
    const ctx = await makeCollateralFixtureContext(this.alice)()
    
    const refPerTok = await ctx.collateral.underlyingRefPerTok()
    const expectedRate = ethers.utils.parseEther('1.05')
    expect(refPerTok).to.equal(expectedRate)
  })

  it('Should handle exchange rate changes', async function () {
    const ctx = await makeCollateralFixtureContext(this.alice)()
    
    // Change exchange rate
    await ctx.mockVault.setExchangeRate(ethers.utils.parseEther('1.06'))
    
    const refPerTok = await ctx.collateral.underlyingRefPerTok()
    const expectedRate = ethers.utils.parseEther('1.06')
    expect(refPerTok).to.equal(expectedRate)
  })
}

const collateralSpecificRewardTests = () => {
  it('Should emit RewardsClaimed event', async function () {
    const ctx = await makeCollateralFixtureContext(this.alice)()
    
    await expect(ctx.collateral.claimRewards())
      .to.emit(ctx.collateral, 'RewardsClaimed')
      .withArgs(ZERO_ADDRESS, 0)
  })
}

const beforeEachRewardsTest = async () => {
  // No specific setup needed for rewards tests
}

// Run the collateral test suite
collateralTests('MoonwellMorphoUSDCCollateral', {
  deployCollateral,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceTargetPerRef,
  increaseTargetPerRef,
  reduceRefPerTok,
  increaseRefPerTok,
  getExpectedPrice,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  collateralSpecificPriceTests,
  collateralSpecificRewardTests,
  beforeEachRewardsTest,
}) 