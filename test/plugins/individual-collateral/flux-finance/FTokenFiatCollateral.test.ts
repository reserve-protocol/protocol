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
  CTokenVault,
  CTokenVaultMock2,
  ICToken,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
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
  PRICE_TIMEOUT,
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
  revenueHiding?: BigNumberish
  erc20IsVault?: boolean
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
  {
    testName: 'fFRAX Collateral',
    underlying: config.tokens.FRAX as string,
    holderUnderlying: FRAX_HOLDER,
    fToken: config.tokens.fFRAX as string,
    oracleError: FRAX_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.FRAX as string,
  },
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
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: curr.chainlinkFeed,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: curr.oracleError,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    comptroller: config.FLUX_FINANCE_COMPTROLLER,
    revenueHiding: 0,
    erc20IsVault: false
  }

  const deployCollateral = async (opts: FTokenCollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    let erc20Address = opts.erc20

    if (erc20Address && erc20Address != ZERO_ADDRESS && erc20Address == curr.fToken) {
      const erc20 = await ethers.getContractAt('ERC20Mock', opts.erc20!)
      const CTokenVaultFactory: ContractFactory = await ethers.getContractFactory(
        'CTokenVault'
      )
      const fTokenVault = <CTokenVault>await CTokenVaultFactory.deploy(
        opts.erc20,
        await erc20.name(),
        await erc20.symbol(),
        ZERO_ADDRESS,
        opts.comptroller!
      )
      erc20Address = fTokenVault.address
    }

    const FTokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenFiatCollateral'
    ) // fTokens are the same as cTokens modulo some extra stuff we don't care about

    const collateral = <TestICollateral>await FTokenCollateralFactory.deploy(
      {
        erc20: erc20Address,
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
      const erc20 = await ethers.getContractAt('CTokenVault', await collateral.erc20() as string) // the fToken

      return {
        alice,
        collateral,
        chainlinkFeed,
        tok: erc20,
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
    const underlyingFToken = await FTokenMockFactory.deploy('Mock FToken', 'Mock Ftk', curr.underlying)

    const CTokenVaultMock2Factory: ContractFactory = await ethers.getContractFactory(
      'CTokenVaultMock2'
    )

    const fTokenVault = <CTokenVaultMock2>await CTokenVaultMock2Factory.deploy(
      await underlyingFToken.name(),
      await underlyingFToken.symbol(),
      underlyingFToken.address,
      ZERO_ADDRESS,
      collateralOpts.comptroller!
    )

    collateralOpts.erc20IsVault = true
    collateralOpts.erc20 = fTokenVault.address

    const collateral = await deployCollateral(collateralOpts)

    return {
      collateral,
      chainlinkFeed,
      tok: fTokenVault,
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
    const tok = ctx.tok as CTokenVault
    const fToken = await ethers.getContractAt('ICToken', await tok.asset())
    const underlying = await ethers.getContractAt('IERC20Metadata', await fToken.underlying())
    await mintFToken(underlying, curr.holderUnderlying, fToken, tok, amount, recipient)
  }

  const increaseRefPerTok = async (ctx: CollateralFixtureContext) => {
    await advanceBlocks(1)
    await (ctx.tok as ICToken).exchangeRateCurrent()
  }

  const collateralSpecificConstructorTests = () => {
    it('Should validate comptroller arg', async () => {
      await expect(deployCollateral({ comptroller: ZERO_ADDRESS })).to.be.revertedWith(
        'comptroller missing'
      )
    })
  }

  const collateralSpecificStatusTests = () => {
    it('does revenue hiding correctly', async () => {
      const { collateral, tok } = await deployCollateralMockContext({ revenueHiding: fp('0.01') })

      const rate = fp('2')
      const rateAsRefPerTok = rate.div(50)
      await (tok as CTokenVaultMock2).setExchangeRate(rate) // above current
      await collateral.refresh()
      const before = await collateral.refPerTok()
      expect(before).to.equal(rateAsRefPerTok.mul(fp('0.99')).div(fp('1')))
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

      // Should be SOUND if drops just under 1%
      await (tok as CTokenVaultMock2).setExchangeRate(rate.mul(fp('0.99001')).div(fp('1')))
      await collateral.refresh()
      let after = await collateral.refPerTok()
      expect(before).to.eq(after)
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

      // Should be DISABLED if drops just over 1%
      await (tok as CTokenVaultMock2).setExchangeRate(before.mul(fp('0.98999')).div(fp('1')))
      await collateral.refresh()
      after = await collateral.refPerTok()
      expect(before).to.be.gt(after)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  }

  const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const initRefPerTok = await ctx.collateral.refPerTok()

    const decimals = await ctx.chainlinkFeed.decimals()

    const initData = await ctx.chainlinkFeed.latestRoundData()
    return initData.answer
      .mul(bn(10).pow(18 - decimals))
      .mul(initRefPerTok)
      .div(fp('1'))
  }

  /*
    Run the test suite
  */

  const emptyFn = () => {
    return
  }

  const opts = {
    deployCollateral,
    collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    beforeEachRewardsTest: emptyFn,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceTargetPerRef: emptyFn,
    increaseTargetPerRef: emptyFn,
    reduceRefPerTok: emptyFn,
    increaseRefPerTok,
    getExpectedPrice,
    itClaimsRewards: it.skip,
    itChecksTargetPerRefDefault: it.skip,
    itChecksRefPerTokDefault: it.skip,
    itChecksPriceChanges: it,
    itHasRevenueHiding: it.skip, // in this file
    resetFork,
    collateralName: curr.testName,
    chainlinkDefaultAnswer: bn('1e8'),
  }

  collateralTests(opts)
})
