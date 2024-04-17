import collateralTests from '../collateralTests'
import forkBlockNumber from '#/test/integration/fork-block-numbers'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { ORACLE_TIMEOUT_BUFFER } from '../../fixtures'
import { makeUSDCUSDCPlus, mintUSDCUSDCPlusVault } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { expectDecayedPrice, expectExactPrice, expectUnpriced } from '../../../../utils/oracles'
import { getResetFork } from '../../helpers'
import {
  ConvexStakingWrapper,
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
  USDCPLUS_BP_POOL,
  USDCPLUS_BP_TOKEN,
  USDC_USDCPLUS_VAULT_HOLDER,
  USDCPLUS_ASSET_REGISTRY,
  USDCPLUS_TIMELOCK,
  CVX,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  USDCPLUS,
} from '../constants'
import { whileImpersonating } from '../../../../utils/impersonation'

type Fixture<T> = () => Promise<T>

export const defaultCvxRecursiveCollateralOpts: CurveCollateralOpts = {
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
  curvePool: USDCPLUS_BP_POOL,
  lpToken: USDCPLUS_BP_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[USDC_USD_FEED], [ONE_ADDRESS]],
  oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [bn('1')]],
  oracleErrors: [[USDC_ORACLE_ERROR], [bn('1')]],
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute both feeds: USDC, USDC+
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcplusFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeUSDCUSDCPlus(usdcplusFeed)

    opts.feeds = [[usdcFeed.address], [usdcplusFeed.address]]
    opts.erc20 = fix.vault.address
  }

  opts = { ...defaultCvxRecursiveCollateralOpts, ...opts }

  const StakeDAORecursiveCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'StakeDAORecursiveCollateral'
  )

  const collateral = <TestICollateral>await StakeDAORecursiveCollateralFactory.deploy(
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
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral as unknown as TestICollateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxRecursiveCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute both feeds: USDC, USDC+
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcplusFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeUSDCUSDCPlus(usdcplusFeed)

    collateralOpts.feeds = [[usdcFeed.address], [usdcplusFeed.address]]
    collateralOpts.erc20 = fix.vault.address
    collateralOpts.curvePool = fix.curvePool.address

    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.curvePool,
      wrapper: fix.vault as unknown as ConvexStakingWrapper,
      rewardTokens: [cvx, crv],
      chainlinkFeed: usdcFeed,
      poolTokens: [fix.usdc, fix.usdcplus],
      feeds: [usdcFeed, usdcplusFeed],
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
  await mintUSDCUSDCPlusVault(ctx, amount, user, recipient, USDC_USDCPLUS_VAULT_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('Does not default if USDC+ defaults', async () => {
    // TODO

    const [collateral] = await deployCollateral({})
    const initialPrice = await collateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)

    // Swap out USDCPLUS's RTokenAsset with a mock one
    const AssetMockFactory = await ethers.getContractFactory('AssetMock')
    const mockRTokenAsset = await AssetMockFactory.deploy(
      bn('1'), // unused
      ONE_ADDRESS, // unused
      bn('1'), // unused
      USDCPLUS,
      bn('1'), // unused
      bn('1') // unused
    )
    const usdcplusAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      USDCPLUS_ASSET_REGISTRY
    )
    await whileImpersonating(USDCPLUS_TIMELOCK, async (signer) => {
      await usdcplusAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
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

  it('Claims rewards', async () => {
    // TODO
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
  itClaimsRewards: it.skip, // in this file
  isMetapool: false,
  resetFork: getResetFork(forkBlockNumber['new-curve-plugins']),
  collateralName: 'StakeDAORecursiveCollateral - StakeDAOVault',
}

collateralTests(opts)
