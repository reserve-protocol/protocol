import collateralTests from '../collateralTests'
import {
  CollateralFixtureContext,
  CollateralOpts,
  MintCollateralFunc,
  CollateralStatus,
} from '../pluginTestTypes'
import { mintWcUSDC, makewCSUDC, resetFork, enableRewardsAccrual } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  CometInterface,
  ICusdcV3Wrapper,
  ICusdcV3WrapperMock,
  CusdcV3WrapperMock,
  CusdcV3Wrapper__factory,
  CusdcV3WrapperMock__factory,
  MockV3Aggregator__factory,
  CometMock,
  CometMock__factory,
  TestICollateral,
} from '../../../../typechain'
import { bn } from '../../../../common/numbers'
import { MAX_UINT48 } from '../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { advanceTime, getLatestBlockTimestamp, setNextBlockTimestamp, advanceBlocks } from '../../../utils/time'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  COMP,
  CUSDC_V3,
  USDC_USD_PRICE_FEED,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REWARDS,
  USDC,
} from './constants'

/*
  Define interfaces
*/

interface CometCollateralFixtureContext extends CollateralFixtureContext {
  cusdcV3: CometInterface
  wcusdcV3: ICusdcV3Wrapper
  usdc: ERC20Mock
  wcusdcV3Mock: CusdcV3WrapperMock
}

interface CometCollateralFixtureContextMockComet extends CollateralFixtureContext {
  cusdcV3: CometMock
  wcusdcV3: ICusdcV3Wrapper
  usdc: ERC20Mock
  wcusdcV3Mock: CusdcV3WrapperMock
}

interface CometCollateralOpts extends CollateralOpts {
  reservesThresholdIffy?: BigNumberish
  reservesThresholdDisabled?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultCometCollateralOpts: CometCollateralOpts = {
  erc20: CUSDC_V3,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: COMP,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: USDC_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  reservesThresholdIffy: bn('10000'),
  reservesThresholdDisabled: bn('5000'),
}

export const deployCollateral = async (
  opts: CometCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultCometCollateralOpts, ...opts }

  const CTokenV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CTokenV3Collateral'
  )

  const collateral = <TestICollateral>await CTokenV3CollateralFactory.deploy(
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
    {
      rewardERC20: opts.rewardERC20,
      reservesThresholdIffy: opts.reservesThresholdIffy,
      reservesThresholdDisabled: opts.reservesThresholdDisabled,
    },
    0,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CometCollateralOpts = {}
): Fixture<CometCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const fix = await makewCSUDC()
    const cusdcV3 = <CometInterface>fix.cusdcV3
    const { wcusdcV3, usdc } = fix

    const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
      await ethers.getContractFactory('CusdcV3WrapperMock')
    )
    const wcusdcV3Mock = <ICusdcV3WrapperMock>(
      ((await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)) as ICusdcV3WrapperMock)
    )
    const realMock = (await ethers.getContractAt(
      'ICusdcV3WrapperMock',
      wcusdcV3Mock.address
    )) as ICusdcV3WrapperMock
    collateralOpts.erc20 = realMock.address
    const collateral = await deployCollateral(collateralOpts)
    const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
    const tokDecimals = await wcusdcV3.decimals()

    return {
      alice,
      collateral,
      chainlinkFeed,
      cusdcV3,
      wcusdcV3: <ICusdcV3WrapperMock>realMock,
      wcusdcV3Mock,
      usdc,
      tok: wcusdcV3,
      rewardToken,
      tokDecimals,
    }
  }

  return makeCollateralFixtureContext
}

const deployCollateralCometMockContext = async (
  opts: CometCollateralOpts = {}
): Promise<CometCollateralFixtureContextMockComet> => {
  const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )
  const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
  collateralOpts.chainlinkFeed = chainlinkFeed.address

  const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
  const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'), CUSDC_V3)

  const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
    await ethers.getContractFactory('CusdcV3Wrapper')
  )

  const wcusdcV3 = <ICusdcV3Wrapper>(
    ((await CusdcV3WrapperFactory.deploy(
      cusdcV3.address,
      REWARDS,
      COMP
    )) as unknown as ICusdcV3Wrapper)
  )
  const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
    await ethers.getContractFactory('CusdcV3WrapperMock')
  )
  const wcusdcV3Mock = await (<ICusdcV3WrapperMock>(
    await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)
  ))

  const realMock = (await ethers.getContractAt(
    'ICusdcV3WrapperMock',
    wcusdcV3Mock.address
  )) as ICusdcV3WrapperMock
  collateralOpts.erc20 = wcusdcV3.address
  collateralOpts.erc20 = realMock.address
  const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
  const collateral = await deployCollateral(collateralOpts)

  const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
  const tokDecimals = await wcusdcV3.decimals()

  return {
    collateral,
    chainlinkFeed,
    cusdcV3,
    wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
    wcusdcV3Mock,
    usdc,
    tok: wcusdcV3,
    rewardToken,
    tokDecimals,
  }
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<CometCollateralFixtureContext> = async (
  ctx: CometCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWcUSDC(ctx.usdc, ctx.cusdcV3, ctx.wcusdcV3, user, amount, recipient)
}

const reduceRefPerTok = async (ctx: CometCollateralFixtureContext, pctDecrease: BigNumberish | undefined) => {
  const currentExchangeRate = await ctx.wcusdcV3.exchangeRate()
  await ctx.wcusdcV3Mock.setMockExchangeRate(true, currentExchangeRate.sub(100))
}

const increaseRefPerTok = async (ctx: CometCollateralFixtureContext, pctIncrease: BigNumberish | undefined) => {
  await advanceBlocks(1000)
  await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)
}

/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {
  it('does not allow missing rewardERC20', async () => {
    await expect(
      deployCollateral({ rewardERC20: ethers.constants.AddressZero })
    ).to.be.revertedWith('rewardERC20 missing')
  })

  it('does not allow 0 reservesThresholdIffy', async () => {
    await expect(
      deployCollateral({ erc20: CUSDC_V3, reservesThresholdIffy: 0 })
    ).to.be.revertedWith('reservesThresholdIffy zero')
  })

  it('does not allow 0 reservesThresholdDisabled', async () => {
    await expect(
      deployCollateral({ erc20: CUSDC_V3, reservesThresholdDisabled: 0 })
    ).to.be.revertedWith('reservesThresholdDisabled zero')
  })
}

const collateralSpecificStatusTests = () => {
  it('enters IFFY state when compound reserves are below target reserves iffy threshold', async () => {
    const mockOpts = { reservesThresholdIffy: 5000n, reservesThresholdDisabled: 1000n }
    const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)
    const delayUntilDefault = await collateral.delayUntilDefault()

    // Check initial state
    await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

    // cUSDC/Comet's reserves gone down below reservesThresholdIffy
    await cusdcV3.setReserves(4000n)

    const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
    await setNextBlockTimestamp(nextBlockTimestamp)
    const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

    await expect(collateral.refresh())
      .to.emit(collateral, 'CollateralStatusChanged')
      .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

    // Move time forward past delayUntilDefault
    await advanceTime(delayUntilDefault)
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Nothing changes if attempt to refresh after default for CTokenV3
    const prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
    await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
  })

  it('enters DISABLED state when reserves threshold is at disabled levels', async () => {
    const mockOpts = { reservesThresholdDisabled: 1000n }
    const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

    // cUSDC/Comet's reserves gone down to 19% of target reserves
    await cusdcV3.setReserves(900n)

    await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
    // State remains the same
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
  })

  it('enters DISABLED state if reserves go negative', async () => {
    const mockOpts = { reservesThresholdDisabled: 1000n }
    const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

    // cUSDC/Comet's reserves gone down to -1
    await cusdcV3.setReserves(-1)

    await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
    // State remains the same
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
  })
}

const beforeEachRewardsTest = async (ctx: CometCollateralFixtureContext) => {
  await enableRewardsAccrual(ctx.cusdcV3)
}

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
  itClaimsRewards: it,
  resetFork,
  collateralName: 'CompoundV3USDC',
  chainlinkDefaultAnswer: bn('1e6')
}

collateralTests(opts)
