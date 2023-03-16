import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  MockV3Aggregator,
  ICToken,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { networkConfig } from '../../../../common/configuration'
import { bn } from '../../../../common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { advanceBlocks } from '../../../utils/time'
import {
  USDC_HOLDER,
  USDT_HOLDER,
  FRAX_HOLDER,
  DAI_HOLDER,
  USDC_ORACLE_ERROR,
  USDT_ORACLE_ERROR,
  DAI_ORACLE_ERROR,
  FRAX_ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
} from './constants'
import { mintFToken, resetFork } from './helpers'

// FTokens are just CompoundV2 CTokens

/*
  Define interfaces
*/

interface FTokenEnumeration {
  testName: string
  underlying: string
  holderUnderlying: string
  fToken: string
  oracleError: BigNumberish
  chainlinkFeed: string
}

// ====

const config = networkConfig['31337'] // use mainnet fork

// Test all 4 fTokens
const all = [
  {
    testName: 'fUSDC Collateral',
    underlying: config.tokens.USDC as string,
    holderUnderlying: USDC_HOLDER,
    fToken: config.tokens.fUSDC as string,
    oracleError: USDC_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.USDC as string,
  },
  {
    testName: 'fUSDT Collateral',
    underlying: config.tokens.USDT as string,
    holderUnderlying: USDT_HOLDER,
    fToken: config.tokens.fUSDT as string,
    oracleError: USDT_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.USDT as string,
  },
  // {
  //   testName: 'fFRAX Collateral',
  //   underlying: config.tokens.FRAX as string,
  //   holderUnderlying: FRAX_HOLDER,
  //   fToken: config.tokens.fFRAX as string,
  //   oracleError: FRAX_ORACLE_ERROR,
  //   chainlinkFeed: config.chainlinkFeeds.FRAX as string,
  // },
  {
    testName: 'fDAI Collateral',
    underlying: config.tokens.DAI as string,
    holderUnderlying: DAI_HOLDER,
    fToken: config.tokens.fDAI as string,
    oracleError: DAI_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.DAI as string,
  },
]
all.forEach((curr: FTokenEnumeration) => {
  const defaultCollateralOpts: CollateralOpts = {
    erc20: curr.fToken,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: ORACLE_TIMEOUT,
    chainlinkFeed: curr.chainlinkFeed,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: curr.oracleError,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
  }

  const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    const FTokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenFiatCollateral'
    ) // fTokens are the same as cTokens modulo some extra stuff we don't care about

    const collateral = <TestICollateral>await FTokenCollateralFactory.deploy(
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
      0, // no revenue hiding
      config.FLUX_FINANCE_COMPTROLLER,
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
    opts: CollateralOpts = {}
  ): Fixture<CollateralFixtureContext> => {
    const collateralOpts = { ...defaultCollateralOpts, ...opts }

    const makeCollateralFixtureContext = async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
      collateralOpts.chainlinkFeed = chainlinkFeed.address

      const collateral = await deployCollateral(collateralOpts)
      const erc20 = await ethers.getContractAt('ICToken', collateralOpts.erc20 as string) // the fToken
      const tokDecimals = await erc20.decimals()

      return {
        alice,
        collateral,
        chainlinkFeed,
        tok: erc20,
        tokDecimals,
      }
    }

    return makeCollateralFixtureContext
  }

  //   const deployCollateralCometMockContext = async (
  //     opts: CollateralOpts = {}
  //   ): Promise<fTokenCollateralFixtureContextMockComet> => {
  //     const collateralOpts = { ...defaultCollateralOpts, ...opts }

  //     const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
  //       await ethers.getContractFactory('MockV3Aggregator')
  //     )
  //     const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
  //     collateralOpts.chainlinkFeed = chainlinkFeed.address

  //     const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
  //     const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'), CUSDC_V3)

  //     const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
  //       await ethers.getContractFactory('CusdcV3Wrapper')
  //     )

  //     const wcusdcV3 = <ICusdcV3Wrapper>(
  //       ((await CusdcV3WrapperFactory.deploy(
  //         cusdcV3.address,
  //         REWARDS,
  //         COMP
  //       )) as unknown as ICusdcV3Wrapper)
  //     )
  //     const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
  //       await ethers.getContractFactory('CusdcV3WrapperMock')
  //     )
  //     const wcusdcV3Mock = await (<ICusdcV3WrapperMock>(
  //       await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)
  //     ))

  //     const realMock = (await ethers.getContractAt(
  //       'ICusdcV3WrapperMock',
  //       wcusdcV3Mock.address
  //     )) as ICusdcV3WrapperMock
  //     collateralOpts.erc20 = wcusdcV3.address
  //     collateralOpts.erc20 = realMock.address
  //     const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
  //     const collateral = await deployCollateral(collateralOpts)

  //     const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
  //     const tokDecimals = await wcusdcV3.decimals()

  //     return {
  //       collateral,
  //       chainlinkFeed,
  //       cusdcV3,
  //       wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
  //       wcusdcV3Mock,
  //       usdc,
  //       tok: wcusdcV3,
  //       rewardToken,
  //       tokDecimals,
  //     }
  //   }

  /*
  Define helper functions
*/

  const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
    ctx: CollateralFixtureContext,
    amount: BigNumberish,
    user: SignerWithAddress,
    recipient: string
  ) => {
    const tok = ctx.tok as ICToken
    const underlying = await ethers.getContractAt('IERC20Metadata', await tok.underlying())
    await mintFToken(underlying, curr.holderUnderlying, tok, amount, recipient)
  }

  const appreciateRefPerTok = async (ctx: CollateralFixtureContext) => {
    await advanceBlocks(1)
    await (ctx.tok as ICToken).exchangeRateCurrent()
  }

  const reduceRefPerTok = async () => {
    return
  }

  const collateralSpecificConstructorTests = () => {
    return
  }

  const collateralSpecificStatusTests = () => {
    // it('enters IFFY state when compound reserves are below target reserves iffy threshold', async () => {
    //   const mockOpts = { reservesThresholdIffy: 5000n, reservesThresholdDisabled: 1000n }
    //   const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)
    //   const delayUntilDefault = await collateral.delayUntilDefault()
    //   // Check initial state
    //   await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    //   expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    //   expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    //   // cUSDC/Comet's reserves gone down below reservesThresholdIffy
    //   await cusdcV3.setReserves(4000n)
    //   const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
    //   await setNextBlockTimestamp(nextBlockTimestamp)
    //   const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault
    //   await expect(collateral.refresh())
    //     .to.emit(collateral, 'CollateralStatusChanged')
    //     .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
    //   expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    //   expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    //   // Move time forward past delayUntilDefault
    //   await advanceTime(delayUntilDefault)
    //   expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    //   // Nothing changes if attempt to refresh after default for CTokenV3
    //   const prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
    //   await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    //   expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    //   expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    // })
    // it('enters DISABLED state when reserves threshold is at disabled levels', async () => {
    //   const mockOpts = { reservesThresholdDisabled: 1000n }
    //   const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)
    //   // Check initial state
    //   expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    //   expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    //   // cUSDC/Comet's reserves gone down to 19% of target reserves
    //   await cusdcV3.setReserves(900n)
    //   await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
    //   // State remains the same
    //   expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    //   expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
    // })
    // it('enters DISABLED state if reserves go negative', async () => {
    //   const mockOpts = { reservesThresholdDisabled: 1000n }
    //   const { collateral, cusdcV3 } = await deployCollateralCometMockContext(mockOpts)
    //   // Check initial state
    //   expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    //   expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    //   // cUSDC/Comet's reserves gone down to -1
    //   await cusdcV3.setReserves(-1)
    //   await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
    //   // State remains the same
    //   expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    //   expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
    // })
    return
  }

  const beforeEachRewardsTest = async () => {
    return
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
    appreciateRefPerTok,
    canReduceRefPerTok: () => false,
    reduceRefPerTok,
    itClaimsRewards: it,
    resetFork,
    collateralName: curr.testName,
  }

  collateralTests(opts)
})
