import collateralTests from '../collateralTests'
import {
  CollateralFixtureContext,
  CollateralStatus,
  CollateralOpts,
  MintCollateralFunc,
} from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  CTokenMock,
  ICToken,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { networkConfig } from '../../../../common/configuration'
import { bn } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { advanceBlocks } from '../../../utils/time'
import {
  USDC_HOLDER,
  USDT_HOLDER,
  // FRAX_HOLDER,
  DAI_HOLDER,
  USDC_ORACLE_ERROR,
  USDT_ORACLE_ERROR,
  DAI_ORACLE_ERROR,
  // FRAX_ORACLE_ERROR,
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

interface FTokenCollateralOpts extends CollateralOpts {
  comptroller?: string
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
  // // as of 3/15/2023 there is only $11 of FRAX in Flux Finance
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
  const defaultCollateralOpts: FTokenCollateralOpts = {
    erc20: curr.fToken,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: ORACLE_TIMEOUT,
    chainlinkFeed: curr.chainlinkFeed,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: curr.oracleError,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    comptroller: config.FLUX_FINANCE_COMPTROLLER,
  }

  const deployCollateral = async (opts: FTokenCollateralOpts = {}): Promise<TestICollateral> => {
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
      opts.comptroller,
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
    opts: FTokenCollateralOpts = {}
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

  const deployCollateralMockContext = async (
    opts: FTokenCollateralOpts = {}
  ): Promise<CollateralFixtureContext> => {
    const collateralOpts = { ...defaultCollateralOpts, ...opts }

    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const FTokenMockFactory = await ethers.getContractFactory('CTokenMock')
    const erc20 = await FTokenMockFactory.deploy('Mock FToken', 'Mock Ftk', curr.underlying)
    collateralOpts.erc20 = erc20.address

    const collateral = await deployCollateral(collateralOpts)
    const tokDecimals = await erc20.decimals()

    return {
      collateral,
      chainlinkFeed,
      tok: erc20,
      tokDecimals,
    }
  }

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
    it('Should validate comptroller arg', async () => {
      await expect(deployCollateral({ comptroller: ZERO_ADDRESS })).to.be.revertedWith(
        'comptroller missing'
      )
    })
  }

  const collateralSpecificStatusTests = () => {
    it('enters DISABLED state if refPerTok falls', async () => {
      const { collateral, tok } = await deployCollateralMockContext()
      const before = await collateral.refPerTok()
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(before).to.be.gt(0)
      await (tok as CTokenMock).setExchangeRate(before.sub(1))
      await collateral.refresh()
      const after = await collateral.refPerTok()
      expect(before).to.be.gt(after)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    })

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
