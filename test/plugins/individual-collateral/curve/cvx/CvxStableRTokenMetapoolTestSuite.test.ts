import collateralTests from '../collateralTests'
import forkBlockNumber from '#/test/integration/fork-block-numbers'
import {
  CurveCollateralFixtureContext,
  CurveMetapoolCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { expectEvents } from '../../../../../common/events'
import { overrideOracle } from '../../../../utils/oracles'
import { ORACLE_TIMEOUT_BUFFER } from '../../fixtures'
import { makeWeUSDFraxBP, mintWeUSDFraxBP } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { expectDecayedPrice, expectExactPrice, expectUnpriced } from '../../../../utils/oracles'
import { getResetFork } from '../../helpers'
import { networkConfig } from '../../../../../common/configuration'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { advanceTime } from '../../../../utils/time'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS, ONE_ADDRESS, MAX_UINT192 } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  eUSD_FRAX_BP,
  FRAX_BP,
  FRAX_BP_TOKEN,
  CVX,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDT_USD_FEED,
  FRAX_USD_FEED,
  FRAX_ORACLE_TIMEOUT,
  FRAX_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  EUSD_ASSET_REGISTRY,
  EUSD_BASKET_HANDLER,
  eUSD_BACKING_MANAGER,
  eUSD_FRAX_HOLDER,
  eUSD,
} from '../constants'
import { whileImpersonating } from '../../../../utils/impersonation'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveMetapoolCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
  oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: RTOKEN_DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 2,
  curvePool: FRAX_BP,
  lpToken: FRAX_BP_TOKEN,
  poolType: CurvePoolType.Plain, // for fraxBP, not the top-level pool
  feeds: [[FRAX_USD_FEED], [USDC_USD_FEED]],
  oracleTimeouts: [[FRAX_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT]],
  oracleErrors: [[FRAX_ORACLE_ERROR], [USDC_ORACLE_ERROR]],
  metapoolToken: eUSD_FRAX_BP,
  pairedTokenDefaultThreshold: DEFAULT_THRESHOLD,
}

export const deployCollateral = async (
  opts: CurveMetapoolCollateralOpts = {}
): Promise<[TestICollateral, CurveMetapoolCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: FRAX, USDC, eUSD
    const fraxFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const eusdFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeWeUSDFraxBP(eusdFeed)

    opts.feeds = [[fraxFeed.address], [usdcFeed.address]]
    opts.erc20 = fix.wPool.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableRTokenMetapoolCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CurveStableRTokenMetapoolCollateral'
  )

  const collateral = <TestICollateral>await CvxStableRTokenMetapoolCollateralFactory.deploy(
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
    {
      nTokens: opts.nTokens,
      curvePool: opts.curvePool,
      poolType: opts.poolType,
      feeds: opts.feeds,
      oracleTimeouts: opts.oracleTimeouts,
      oracleErrors: opts.oracleErrors,
      lpToken: opts.lpToken,
    },
    opts.metapoolToken,
    opts.pairedTokenDefaultThreshold
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral as unknown as TestICollateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveMetapoolCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all feeds: FRAX, USDC, RToken
    const fraxFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const eusdFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const fix = await makeWeUSDFraxBP(eusdFeed)
    collateralOpts.feeds = [[fraxFeed.address], [usdcFeed.address]]

    collateralOpts.erc20 = fix.wPool.address
    collateralOpts.curvePool = fix.curvePool.address
    collateralOpts.metapoolToken = fix.metapoolToken.address

    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.metapoolToken,
      wrapper: fix.wPool,
      rewardTokens: [cvx, crv],
      chainlinkFeed: usdcFeed,
      poolTokens: [fix.frax, fix.usdc],
      feeds: [fraxFeed, usdcFeed, eusdFeed],
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCurveCollateralFunc<CurveCollateralFixtureContext> = async (
  ctx: CurveCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWeUSDFraxBP(ctx, amount, user, recipient, eUSD_FRAX_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  it('does not allow empty metaPoolToken', async () => {
    await expect(deployCollateral({ metapoolToken: ZERO_ADDRESS })).to.be.revertedWith(
      'metapoolToken address is zero'
    )
  })

  it('does not allow invalid pairedTokenDefaultThreshold', async () => {
    await expect(deployCollateral({ pairedTokenDefaultThreshold: bn(0) })).to.be.revertedWith(
      'pairedTokenDefaultThreshold out of bounds'
    )

    await expect(
      deployCollateral({ pairedTokenDefaultThreshold: bn('1.1e18') })
    ).to.be.revertedWith('pairedTokenDefaultThreshold out of bounds')
  })
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('Regression test -- becomes unpriced if inner RTokenAsset becomes unpriced', async () => {
    const [collateral] = await deployCollateral({})
    const initialPrice = await collateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)

    // Swap out eUSD's RTokenAsset with a mock one
    const AssetMockFactory = await ethers.getContractFactory('AssetMock')
    const mockRTokenAsset = await AssetMockFactory.deploy(
      bn('1'), // unused
      ONE_ADDRESS, // unused
      bn('1'), // unused
      eUSD,
      bn('1'), // unused
      bn('1') // unused
    )
    const eUSDAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      '0x9B85aC04A09c8C813c37de9B3d563C2D3F936162'
    )
    await whileImpersonating('0xc8Ee187A5e5c9dC9b42414Ddf861FFc615446a2c', async (signer) => {
      await eUSDAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
    })

    // Set RTokenAsset to unpriced
    // Would be the price under a stale oracle timeout for a poorly-coded RTokenAsset
    await mockRTokenAsset.setPrice(0, MAX_UINT192)
    await expectExactPrice(collateral.address, initialPrice)

    // Should decay after oracle timeout
    await advanceTime((await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER)
    await expectDecayedPrice(collateral.address)

    // Should be unpriced after price timeout
    await advanceTime(await collateral.priceTimeout())
    await expectUnpriced(collateral.address)

    // refresh() should not revert
    await collateral.refresh()
  })

  it('Regression test -- refreshes inner RTokenAsset on refresh()', async () => {
    const [collateral] = await deployCollateral({})
    const initialPrice = await collateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)

    // Swap out eUSD's RTokenAsset with a mock one
    const AssetMockFactory = await ethers.getContractFactory('AssetMock')
    const mockRTokenAsset = await AssetMockFactory.deploy(
      bn('1'), // unused
      ONE_ADDRESS, // unused
      bn('1'), // unused
      eUSD,
      bn('1'), // unused
      bn('1') // unused
    )
    const eUSDAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      '0x9B85aC04A09c8C813c37de9B3d563C2D3F936162'
    )
    await whileImpersonating('0xc8Ee187A5e5c9dC9b42414Ddf861FFc615446a2c', async (signer) => {
      await eUSDAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
    })

    // Set RTokenAsset price to stale
    await mockRTokenAsset.setStale(true)
    expect(await mockRTokenAsset.stale()).to.be.true

    // Refresh CurveStableRTokenMetapoolCollateral
    await collateral.refresh()

    // Stale should be false again
    expect(await mockRTokenAsset.stale()).to.be.false
  })

  it('Regression test -- stays IFFY throughout inner RToken default + rebalancing', async () => {
    const [collateral, opts] = await deployCollateral({})
    const eusdAssetRegistry = await ethers.getContractAt('IAssetRegistry', EUSD_ASSET_REGISTRY)
    const eusdBasketHandler = await ethers.getContractAt('TestIBasketHandler', EUSD_BASKET_HANDLER)
    const cUSDTCollateral = await ethers.getContractAt(
      'CTokenFiatCollateral',
      await eusdAssetRegistry.toAsset(networkConfig['1'].tokens.cUSDT!)
    )
    const initialPrice = await cUSDTCollateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)
    expect(await cUSDTCollateral.status()).to.equal(0)

    // De-peg oracle 20%
    const chainlinkFeed = await cUSDTCollateral.chainlinkFeed()
    const oracle = await overrideOracle(chainlinkFeed)
    const latestAnswer = await oracle.latestAnswer()
    await oracle.updateAnswer(latestAnswer.mul(4).div(5))

    // CTokenFiatCollateral + CurveStableRTokenMetapoolCollateral should
    // become IFFY through the top-level refresh
    await expectEvents(collateral.refresh(), [
      {
        contract: eusdBasketHandler,
        name: 'BasketStatusChanged',
        args: [0, 1],
        emitted: true,
      },
      {
        contract: cUSDTCollateral,
        name: 'CollateralStatusChanged',
        args: [0, 1],
        emitted: true,
      },
      {
        contract: collateral,
        name: 'CollateralStatusChanged',
        args: [0, 1],
        emitted: true,
      },
    ])
    expect(await cUSDTCollateral.status()).to.equal(1)
    expect(await collateral.status()).to.equal(1)
    expect(await eusdBasketHandler.status()).to.equal(1)
    expect(await eusdBasketHandler.isReady()).to.equal(false)

    // Should remain IFFY while rebalancing
    await advanceTime((await cUSDTCollateral.delayUntilDefault()) + 1) // 24h

    // prevent oracles from becoming stale
    for (const feedAddr of opts.feeds!) {
      const feed = await ethers.getContractAt('MockV3Aggregator', feedAddr[0])
      await feed.updateAnswer(await feed.latestAnswer())
    }
    const usdcOracle = await overrideOracle(USDC_USD_FEED)
    await usdcOracle.updateAnswer(await usdcOracle.latestAnswer())
    const usdtOracle = await overrideOracle(USDT_USD_FEED)
    await usdtOracle.updateAnswer(await usdtOracle.latestAnswer())

    // Should remain IFFY
    expect(await eusdBasketHandler.status()).to.equal(2)
    expect(await cUSDTCollateral.status()).to.equal(2)
    expect(await collateral.status()).to.equal(1)
    await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    await eusdBasketHandler.refreshBasket() // swaps WETH into basket in place of wstETH
    expect(await eusdBasketHandler.status()).to.equal(0)
    expect(await eusdBasketHandler.isReady()).to.equal(false)
    expect(await eusdBasketHandler.fullyCollateralized()).to.equal(false)

    // Advancing the warmupPeriod should not change anything while rebalancing
    await advanceTime((await eusdBasketHandler.warmupPeriod()) + 1)
    expect(await eusdBasketHandler.isReady()).to.equal(true)
    await collateral.refresh()
    expect(await eusdBasketHandler.status()).to.equal(0)
    expect(await cUSDTCollateral.status()).to.equal(2)
    expect(await collateral.status()).to.equal(1)

    // Should go back to SOUND after fullyCollateralized again -- backs up to USDC + USDT
    const usdc = await ethers.getContractAt('IERC20Metadata', networkConfig['1'].tokens.USDC!)
    await whileImpersonating('0x4B16c5dE96EB2117bBE5fd171E4d203624B014aa', async (whale) => {
      await usdc.connect(whale).transfer(eUSD_BACKING_MANAGER, await usdc.balanceOf(whale.address))
    })
    const usdt = await ethers.getContractAt('IERC20Metadata', networkConfig['1'].tokens.USDT!)
    await whileImpersonating('0xF977814e90dA44bFA03b6295A0616a897441aceC', async (whale) => {
      await usdt.connect(whale).transfer(eUSD_BACKING_MANAGER, await usdt.balanceOf(whale.address))
    })
    expect(await eusdBasketHandler.fullyCollateralized()).to.equal(true)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(0)
  })
}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  makeCollateralFixtureContext,
  mintCollateralTo,
  itChecksTargetPerRefDefault: it,
  itClaimsRewards: it,
  isMetapool: true,
  resetFork: getResetFork(forkBlockNumber['new-curve-plugins']),
  collateralName: 'CurveStableRTokenMetapoolCollateral - ConvexStakingWrapper',
}

collateralTests(opts)
