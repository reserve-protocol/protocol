import collateralTests from '../collateralTests'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator, MockV3Aggregator__factory, TestICollateral } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { CollateralOpts, CollateralFixtureContext } from '../pluginTestTypes'
import { resetFork, transferBnToken, getExpectedPriceFactory, increaseTargetPerRef, reduceTargetPerRef, increaseRefPerTokFactory, reduceRefPerTokFactory } from './helpers'
import {
    BANCOR_POOL_COLLECTION,
    BANCOR_STANDARD_REWARDS,
    BNT_TOKEN,
    BNUSDC_TOKEN,
    BNUSDC_HOLDER,
    USDC_TO_USD_PRICE_FEED,
    USDC_TO_USD_PRICE_ERROR,
    PRICE_TIMEOUT,
    ORACLE_TIMEOUT,
    DEFAULT_THRESHOLD,
    DELAY_UNTIL_DEFAULT,
    MAX_TRADE_VOL,
    REVENUE_HIDING,
} from './constants'

// default parameters

const defaultCollateralOpts: CollateralOpts = {
    erc20: BNUSDC_TOKEN,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: USDC_TO_USD_PRICE_FEED,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: USDC_TO_USD_PRICE_ERROR,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    revenueHiding: REVENUE_HIDING,
}

// Generic constants

type Fixture<T> = (...args: any[]) => Promise<T>

const emptyFn = () => {return}

// Deployment factory

const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
    const _opts = { ...defaultCollateralOpts, ...opts }

    const _BnTokenFiatCollateralFactory: ContractFactory = await ethers.getContractFactory('BnTokenFiatCollateral')

    const _collateral = <TestICollateral>await _BnTokenFiatCollateralFactory.deploy(
        {
            erc20: _opts.erc20,
            targetName: _opts.targetName,
            priceTimeout: _opts.priceTimeout,
            chainlinkFeed: _opts.chainlinkFeed,
            oracleError: _opts.oracleError,
            oracleTimeout: _opts.oracleTimeout,
            maxTradeVolume: _opts.maxTradeVolume,
            defaultThreshold: _opts.defaultThreshold,
            delayUntilDefault: _opts.delayUntilDefault,
        },
        BANCOR_POOL_COLLECTION,
        BANCOR_STANDARD_REWARDS,
        _opts.revenueHiding,
        { gasLimit: 2000000000 }
    )
    await _collateral.deployed()

    // sometimes we are trying to test a negative test case and we want this to fail silently
    // fortunately this syntax fails silently because our tools are terrible
    await expect(_collateral.refresh())

    return _collateral
}

// Collateral fixture factory

const makeMakeCollateralFixtureContext = (alice: SignerWithAddress, opts: CollateralOpts = {}): Fixture<CollateralFixtureContext> => {
    const _opts = { ...defaultCollateralOpts, ...opts }

    const _makeCollateralFixtureContext = async () => {
        const _mockV3AggregatorFactory = <MockV3Aggregator__factory>(await ethers.getContractFactory('MockV3Aggregator'))
        const _chainlinkFeed = <MockV3Aggregator>await _mockV3AggregatorFactory.deploy(8, bn('1e8'))
        _opts.chainlinkFeed = _chainlinkFeed.address

        const _collateral = await deployCollateral(_opts)
        const _erc20 = await ethers.getContractAt('IPoolToken', _opts.erc20 as string) // the Bancor pool
        const _bnt = await ethers.getContractAt('IERC20Metadata', BNT_TOKEN as string) // rewards are handed in BNT

        return {
            alice: alice,
            collateral: _collateral,
            chainlinkFeed: _chainlinkFeed,
            tok: _erc20,
            rewardToken: _bnt,
        }
    }

    return _makeCollateralFixtureContext
}

// Bancor token minting factory

const mintCollateralTo = async (ctx: CollateralFixtureContext, amount: BigNumberish, user: SignerWithAddress, recipient: string) => {
    await transferBnToken(BNUSDC_HOLDER, ctx.tok, amount, recipient)
}

// Specific tests factory

const collateralSpecificStatusTests = () => {}

// Run the test suite

const opts = {
    deployCollateral: deployCollateral,
    collateralSpecificConstructorTests: emptyFn,
    collateralSpecificStatusTests: collateralSpecificStatusTests,
    beforeEachRewardsTest: emptyFn,
    makeCollateralFixtureContext: makeMakeCollateralFixtureContext,
    mintCollateralTo: mintCollateralTo,
    reduceTargetPerRef: reduceTargetPerRef,
    increaseTargetPerRef: increaseTargetPerRef,
    reduceRefPerTok: reduceRefPerTokFactory(BNUSDC_HOLDER, BANCOR_POOL_COLLECTION),
    increaseRefPerTok: increaseRefPerTokFactory(BNUSDC_HOLDER),
    getExpectedPrice: getExpectedPriceFactory(BANCOR_POOL_COLLECTION),
    itClaimsRewards: it.skip,
    itChecksTargetPerRefDefault: it,
    itChecksRefPerTokDefault: it,
    itChecksPriceChanges: it,
    itHasRevenueHiding: it,
    itIsPricedByPeg: true,
    resetFork: resetFork,
    collateralName: 'bnUSDC Collateral',
    chainlinkDefaultAnswer: bn('1e8'), // 8 decimals,
}

collateralTests(opts)
