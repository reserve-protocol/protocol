import { expect } from 'chai'
import { Wallet, ContractFactory, BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { networkConfig } from '../../../../common/configuration'
import { getChainId } from '../../../../common/blockchain-utils'
import { advanceTime, getLatestBlockTimestamp, advanceToTimestamp } from '../../../utils/time'
import { ZERO_ADDRESS, MAX_UINT192 } from '../../../../common/constants'
import { bn, fp } from '../../../../common/numbers'
import {
  expectDecayedPrice,
  expectExactPrice,
  expectPrice,
  expectUnpriced,
  setInvalidOracleAnsweredRound,
  setInvalidOracleTimestamp,
  setOraclePrice,
} from '../../../utils/oracles'
import {
  ERC20Mock,
  InvalidMockV3Aggregator,
  MockUniswapV3Pool,
  MockV3Aggregator,
  MorphoAsset,
} from '../../../../typechain'
import { VERSION } from '../../../fixtures'
import { useEnv } from '#/utils/env'
import {
  MORPHO,
  WETH,
  USDC,
  WBTC,
  MORPHO_WETH_POOL_030,
  MORPHO_WETH_POOL_100,
  ETH_USD_FEED,
  ETH_ORACLE_TIMEOUT,
  MORPHO_ORACLE_ERROR,
  PRICE_TIMEOUT,
  MORPHO_MAX_TRADE_VOLUME,
  MORPHO_TWAP_WINDOW,
  MORPHO_ASSET_FORK_BLOCK,
  MORPHO_USD_AT_FORK_BLOCK,
} from './constants'

let chainId: string

const setup = async (blockNumber: number) => {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

const describeFork =
  useEnv('FORK') && useEnv('FORK_NETWORK') === 'mainnet' ? describe : describe.skip

const DECAY_DELAY = ETH_ORACLE_TIMEOUT.add(310)

describeFork('MorphoAsset #fast', () => {
  let morpho: ERC20Mock
  let morphoAsset: MorphoAsset
  let wallet: Wallet
  let MorphoAssetFactory: ContractFactory
  let ethUsdOracle: MockV3Aggregator
  let ethPrice: BigNumber

  // Deploy with overridable args, defaulting to the production configuration
  const deployAsset = async (
    overrides: {
      priceTimeout?: BigNumber
      feed?: string
      oracleError?: BigNumber
      erc20?: string
      maxTradeVolume?: BigNumber
      oracleTimeout?: BigNumber
      pool?: string
      quoteToken?: string
      twapWindow?: number
    } = {}
  ): Promise<MorphoAsset> => {
    return <MorphoAsset>(
      await MorphoAssetFactory.deploy(
        overrides.priceTimeout ?? PRICE_TIMEOUT,
        overrides.feed ?? ethUsdOracle.address,
        overrides.oracleError ?? MORPHO_ORACLE_ERROR,
        overrides.erc20 ?? MORPHO,
        overrides.maxTradeVolume ?? MORPHO_MAX_TRADE_VOLUME,
        overrides.oracleTimeout ?? ETH_ORACLE_TIMEOUT,
        overrides.pool ?? MORPHO_WETH_POOL_030,
        overrides.quoteToken ?? WETH,
        overrides.twapWindow ?? MORPHO_TWAP_WINDOW
      )
    )
  }

  // Independently compute the pool's arithmetic mean tick, straight from observe()
  const meanTickFromPool = async (pool: string, window: number): Promise<number> => {
    const p = await ethers.getContractAt('IUniswapV3Pool', pool)
    const { tickCumulatives } = await p.observe([window, 0])
    const delta = tickCumulatives[1].sub(tickCumulatives[0])
    let tick = delta.div(window)
    if (delta.lt(0) && !delta.mod(window).isZero()) tick = tick.sub(1)
    return tick.toNumber()
  }

  before(async () => {
    await setup(MORPHO_ASSET_FORK_BLOCK)
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    await setup(MORPHO_ASSET_FORK_BLOCK)

    morpho = await ethers.getContractAt('ERC20Mock', MORPHO)

    // Mirror the live ETH/USD feed into a mock so tests can drive it
    const ethOracle = await ethers.getContractAt('AggregatorV3Interface', ETH_USD_FEED)
    ethPrice = (await ethOracle.latestRoundData()).answer

    const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    ethUsdOracle = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, ethPrice)
    await ethUsdOracle.deployed()
    await ethUsdOracle.updateAnswer(ethPrice)

    MorphoAssetFactory = await ethers.getContractFactory('MorphoAsset')
    morphoAsset = await deployAsset()
    await morphoAsset.deployed()
    await morphoAsset.refresh()
  })

  describe('Deployment', () => {
    it('sets up the MORPHO asset correctly', async () => {
      expect(await morphoAsset.isCollateral()).to.equal(false)
      expect(await morphoAsset.erc20()).to.equal(MORPHO)
      expect(await morpho.decimals()).to.equal(18)
      expect(await morphoAsset.erc20Decimals()).to.equal(18)
      expect(await morphoAsset.version()).to.equal(VERSION)
      expect(await morphoAsset.maxTradeVolume()).to.equal(MORPHO_MAX_TRADE_VOLUME)
      expect(await morphoAsset.priceTimeout()).to.equal(PRICE_TIMEOUT)
      expect(await morphoAsset.oracleError()).to.equal(MORPHO_ORACLE_ERROR)
      expect(await morphoAsset.oracleTimeout()).to.equal(ETH_ORACLE_TIMEOUT)
      expect(await morphoAsset.uniswapV3Pool()).to.equal(MORPHO_WETH_POOL_030)
      expect(await morphoAsset.quoteToken()).to.equal(WETH)
      expect(await morphoAsset.twapWindow()).to.equal(MORPHO_TWAP_WINDOW)
    })

    it('prices MORPHO at the expected level for the fork block', async () => {
      await expectPrice(
        morphoAsset.address,
        MORPHO_USD_AT_FORK_BLOCK,
        MORPHO_ORACLE_ERROR,
        true,
        bn('1e3')
      )
    })

    it('claimRewards is a no-op', async () => {
      await expect(morphoAsset.claimRewards()).to.not.emit(morphoAsset, 'RewardsClaimed')
    })

    it('bal() reports whole-token balances', async () => {
      expect(await morphoAsset.bal(wallet.address)).to.equal(0)
    })
  })

  describe('Constructor validation', () => {
    // --- inherited from Asset ---
    it('does not allow price timeout of zero', async () => {
      await expect(deployAsset({ priceTimeout: bn(0) })).to.be.revertedWith('price timeout zero')
    })

    it('does not allow missing chainlink feed', async () => {
      await expect(deployAsset({ feed: ZERO_ADDRESS })).to.be.revertedWith('missing chainlink feed')
    })

    it('does not allow missing erc20', async () => {
      await expect(deployAsset({ erc20: ZERO_ADDRESS })).to.be.revertedWith('missing erc20')
    })

    it('does not allow zero oracleError', async () => {
      await expect(deployAsset({ oracleError: bn(0) })).to.be.revertedWith(
        'oracle error out of range'
      )
    })

    it('does not allow FIX_ONE oracleError', async () => {
      await expect(deployAsset({ oracleError: fp('1') })).to.be.revertedWith(
        'oracle error out of range'
      )
    })

    it('does not allow zero oracleTimeout', async () => {
      await expect(deployAsset({ oracleTimeout: bn(0) })).to.be.revertedWith('oracleTimeout zero')
    })

    it('does not allow zero maxTradeVolume', async () => {
      await expect(deployAsset({ maxTradeVolume: bn(0) })).to.be.revertedWith(
        'invalid max trade volume'
      )
    })

    // --- MorphoAsset-specific ---
    it('does not allow a missing pool', async () => {
      await expect(deployAsset({ pool: ZERO_ADDRESS })).to.be.revertedWith('missing pool')
    })

    it('does not allow a missing quoteToken', async () => {
      await expect(deployAsset({ quoteToken: ZERO_ADDRESS })).to.be.revertedWith(
        'missing quoteToken'
      )
    })

    it('does not allow quoteToken == erc20', async () => {
      await expect(deployAsset({ quoteToken: MORPHO })).to.be.revertedWith('quoteToken is erc20')
    })

    it('does not allow a zero twapWindow', async () => {
      await expect(deployAsset({ twapWindow: 0 })).to.be.revertedWith('twapWindow zero')
    })

    it('rejects a pool that does not hold the erc20/quoteToken pair', async () => {
      await expect(deployAsset({ quoteToken: USDC })).to.be.revertedWith('pool token mismatch')
    })

    it('rejects a pool that cannot serve the requested twapWindow', async () => {
      // 100 years of observations are certainly not retained -> the constructor probe reverts
      await expect(deployAsset({ twapWindow: 3153600000 })).to.be.reverted
    })

    it('accepts the erc20 in either token slot', async () => {
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')

      // Uniswap always orders a pool's tokens by address, so which slot MORPHO occupies is
      // determined by the pair: MORPHO(0x58D9..) < WETH(0xC02a..) but > WBTC(0x2260..).
      const asToken0 = <MockUniswapV3Pool>await MockPoolFactory.deploy(MORPHO, WETH, -68382)
      const asToken1 = <MockUniswapV3Pool>await MockPoolFactory.deploy(WBTC, MORPHO, 335624)
      await expect(deployAsset({ pool: asToken0.address })).to.not.be.reverted
      await expect(deployAsset({ pool: asToken1.address, quoteToken: WBTC })).to.not.be.reverted
    })
  })

  describe('TWAP pricing', () => {
    it('matches an independently computed TWAP from the live pool', async () => {
      const meanTick = await meanTickFromPool(MORPHO_WETH_POOL_030, MORPHO_TWAP_WINDOW)

      // {WETH/MORPHO} = 1.0001^tick, since MORPHO is token0 and both tokens have 18 decimals
      const wethPerMorpho = Math.pow(1.0001, meanTick)
      const expected = fp(String(wethPerMorpho.toFixed(18)))
        .mul(ethPrice)
        .div(bn('1e8'))

      const [low, high] = await morphoAsset.price()
      const mid = low.add(high).div(2)
      expect(mid).to.be.closeTo(expected, expected.div(bn('1e4'))) // 1 part in 10k
    })

    it('scales linearly with the ETH/USD feed', async () => {
      const [low0, high0] = await morphoAsset.price()

      await setOraclePrice(morphoAsset.address, ethPrice.mul(2))
      const [low1, high1] = await morphoAsset.price()

      expect(low1).to.be.closeTo(low0.mul(2), low0.div(bn('1e6')))
      expect(high1).to.be.closeTo(high0.mul(2), high0.div(bn('1e6')))
    })

    it('applies oracleError symmetrically around the TWAP price', async () => {
      const [low, high] = await morphoAsset.price()
      const mid = low.add(high).div(2)
      expect(low).to.be.closeTo(mid.sub(mid.mul(MORPHO_ORACLE_ERROR).div(fp('1'))), bn('1e12'))
      expect(high).to.be.closeTo(mid.add(mid.mul(MORPHO_ORACLE_ERROR).div(fp('1'))), bn('1e12'))
    })

    it('the 1% pool prices MORPHO close to the 0.30% pool', async () => {
      const other = await deployAsset({ pool: MORPHO_WETH_POOL_100 })
      const [lowA, highA] = await morphoAsset.price()
      const [lowB, highB] = await other.price()
      const midA = lowA.add(highA).div(2)
      const midB = lowB.add(highB).div(2)
      expect(midB).to.be.closeTo(midA, midA.div(20)) // within 5%
    })

    it('a longer window still prices within a narrow band of the shorter one', async () => {
      const long = await deployAsset({ twapWindow: 3600 })
      expect(await long.twapWindow()).to.equal(3600)
      const [lowA, highA] = await morphoAsset.price()
      const [lowB, highB] = await long.price()
      expect(lowB.add(highB).div(2)).to.be.closeTo(
        lowA.add(highA).div(2),
        lowA.add(highA).div(2).div(10) // within 10%
      )
    })

    it('handles a lower-address quote token and non-18-decimal quote', async () => {
      // MORPHO(0x58D9..) > WBTC(0x2260..), so the pool is (WBTC, MORPHO) and getQuoteAtTick
      // takes its inverse branch. WBTC also has 8 decimals, exercising the decimal shift.
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')
      const tick = 335624
      const pool = <MockUniswapV3Pool>await MockPoolFactory.deploy(WBTC, MORPHO, tick)
      const asset = await deployAsset({ pool: pool.address, quoteToken: WBTC })

      // 1.0001^tick = {qMORPHO/qWBTC}; so {WBTC/MORPHO} = (1e18 / ratio) / 1e8
      const ratio = Math.pow(1.0001, tick)
      const wbtcPerMorpho = 1e18 / ratio / 1e8
      const expected = fp(wbtcPerMorpho.toFixed(18)).mul(ethPrice).div(bn('1e8'))

      const [low, high] = await asset.price()
      const mid = low.add(high).div(2)
      expect(mid).to.be.closeTo(expected, expected.div(bn('1e3'))) // 1 part in 1k

      // Raising the tick means more MORPHO per WBTC, i.e. MORPHO is cheaper
      await pool.setMeanTick(tick + 6932)
      const [low2, high2] = await asset.price()
      expect(low2.add(high2).div(2)).to.be.closeTo(mid.div(2), mid.div(100))
    })

    it('price tracks the mean tick', async () => {
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')
      const pool = <MockUniswapV3Pool>await MockPoolFactory.deploy(MORPHO, WETH, -68382)
      const asset = await deployAsset({ pool: pool.address })

      const [low0, high0] = await asset.price()

      // +6932 ticks ~ 2x price (1.0001^6932 ~= 2.0)
      await pool.setMeanTick(-68382 + 6932)
      const [low1, high1] = await asset.price()

      expect(low1).to.be.closeTo(low0.mul(2), low0.div(100))
      expect(high1).to.be.closeTo(high0.mul(2), high0.div(100))

      // and downwards
      await pool.setMeanTick(-68382 - 6932)
      const [low2] = await asset.price()
      expect(low2).to.be.closeTo(low0.div(2), low0.div(100))
    })

    it('is unaffected by the ETH/USD feed when the pool moves, and vice versa', async () => {
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')
      const pool = <MockUniswapV3Pool>await MockPoolFactory.deploy(MORPHO, WETH, -68382)
      const asset = await deployAsset({ pool: pool.address })

      const [low0] = await asset.price()

      // Pool doubles, feed constant -> price doubles
      await pool.setMeanTick(-68382 + 6932)
      const [low1] = await asset.price()
      expect(low1).to.be.closeTo(low0.mul(2), low0.div(100))

      // Feed halves, pool constant -> back to ~original
      await setOraclePrice(asset.address, ethPrice.div(2))
      const [low2] = await asset.price()
      expect(low2).to.be.closeTo(low0, low0.div(100))
    })
  })

  describe('TWAP unavailability', () => {
    it('decays to unpriced if the pool can no longer serve the window', async () => {
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')
      const pool = <MockUniswapV3Pool>await MockPoolFactory.deploy(MORPHO, WETH, -68382)
      const asset = await deployAsset({ pool: pool.address })
      await asset.refresh()

      const savedPrice = await asset.price()

      // Simulate observation history being evicted: observe() now reverts "OLD"
      await pool.setRevertOld(true)

      // tryPrice reverts, so refresh() saves nothing and the saved price is retained
      await expect(asset.tryPrice()).to.be.revertedWith('OLD')
      await asset.refresh()
      await expectExactPrice(asset.address, savedPrice)

      // After the decay delay the price band widens
      await advanceTime(DECAY_DELAY.toString())
      await asset.refresh()
      await expectDecayedPrice(asset.address)

      // After the full price timeout it is unpriced
      await advanceTime(PRICE_TIMEOUT.toString())
      await expectUnpriced(asset.address)
    })

    it('refresh() does not revert when the pool reverts', async () => {
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')
      const pool = <MockUniswapV3Pool>await MockPoolFactory.deploy(MORPHO, WETH, -68382)
      const asset = await deployAsset({ pool: pool.address })
      await asset.refresh()

      await pool.setRevertOld(true)
      await expect(asset.refresh()).to.not.be.reverted
    })

    it('recovers if the pool becomes serviceable again', async () => {
      const MockPoolFactory = await ethers.getContractFactory('MockUniswapV3Pool')
      const pool = <MockUniswapV3Pool>await MockPoolFactory.deploy(MORPHO, WETH, -68382)
      const asset = await deployAsset({ pool: pool.address })
      await asset.refresh()
      const before = await asset.price()

      await pool.setRevertOld(true)
      await asset.refresh()

      await pool.setRevertOld(false)
      await asset.refresh()
      await expectExactPrice(asset.address, before)
    })
  })

  describe('Chainlink feed failure', () => {
    it('remains at the saved price if the feed is stale', async () => {
      const initialPrice = await morphoAsset.price()
      await advanceTime(DECAY_DELAY.sub(12).toString())

      await morphoAsset.refresh()
      expect(await morphoAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      await expectExactPrice(morphoAsset.address, initialPrice)
    })

    it('remains at the saved price on an invalid timestamp', async () => {
      const initialPrice = await morphoAsset.price()
      await setInvalidOracleTimestamp(morphoAsset.address)

      await morphoAsset.refresh()
      expect(await morphoAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      await expectExactPrice(morphoAsset.address, initialPrice)
    })

    it('remains at the saved price on an invalid answered round', async () => {
      const initialPrice = await morphoAsset.price()
      await setInvalidOracleAnsweredRound(morphoAsset.address)

      await morphoAsset.refresh()
      expect(await morphoAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      await expectExactPrice(morphoAsset.address, initialPrice)
    })

    it('becomes unpriced if the feed reports zero', async () => {
      const initPrice = await morphoAsset.price()
      await setOraclePrice(morphoAsset.address, bn('0'))
      await expectExactPrice(morphoAsset.address, initPrice)

      await advanceTime(DECAY_DELAY.add(1).toString())
      await setOraclePrice(morphoAsset.address, bn('0'))
      await morphoAsset.refresh()
      await expectDecayedPrice(morphoAsset.address)

      await advanceTime(PRICE_TIMEOUT.toString())
      await setOraclePrice(morphoAsset.address, bn('0'))
      await expectUnpriced(morphoAsset.address)
    })

    it('reverts if the feed reverts or runs out of gas', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidFeed = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )
      const invalidAsset = await deployAsset({ feed: invalidFeed.address })

      await invalidFeed.setSimplyRevert(true)
      await expect(invalidAsset.price()).to.be.reverted
      await expect(invalidAsset.refresh()).to.be.reverted

      await invalidFeed.setSimplyRevert(false)
      await expect(invalidAsset.price()).to.be.reverted
      await expect(invalidAsset.refresh()).to.be.reverted
    })

    it('bubbles up an explicit feed error', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidFeed = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )
      const invalidAsset = await deployAsset({ feed: invalidFeed.address })

      await invalidFeed.setRevertWithExplicitError(true)
      await expect(invalidAsset.tryPrice()).to.be.revertedWith('oracle explicit error')
    })
  })

  describe('Saved prices & decay', () => {
    it('saves prices on refresh', async () => {
      let currBlockTimestamp: number = await getLatestBlockTimestamp()
      const [lowPrice, highPrice] = await morphoAsset.price()
      expect(await morphoAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await morphoAsset.savedHighPrice()).to.equal(highPrice)
      expect(await morphoAsset.lastSave()).to.equal(currBlockTimestamp)

      // Raise the feed; saved prices lag until refresh
      await setOraclePrice(morphoAsset.address, ethPrice.mul(120).div(100))
      const [newLow, newHigh] = await morphoAsset.price()
      expect(await morphoAsset.savedLowPrice()).to.be.lt(newLow)
      expect(await morphoAsset.savedHighPrice()).to.be.lt(newHigh)

      await morphoAsset.refresh()
      expect(await morphoAsset.savedLowPrice()).to.equal(newLow)
      expect(await morphoAsset.savedHighPrice()).to.equal(newHigh)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await morphoAsset.lastSave()).to.equal(currBlockTimestamp)
      expect(newLow).to.be.gt(lowPrice)
      expect(newHigh).to.be.gt(highPrice)
    })

    it('decays the price band over priceTimeout', async () => {
      await morphoAsset.refresh()
      const [prevLow, prevHigh] = await morphoAsset.price()

      await setInvalidOracleTimestamp(morphoAsset.address)

      // No decay at first
      const [low2, high2] = await morphoAsset.price()
      expect(low2).to.equal(prevLow)
      expect(high2).to.equal(prevHigh)

      await advanceTime(DECAY_DELAY.toString())
      const [low3, high3] = await morphoAsset.price()
      expect(low3).to.be.lt(low2)
      expect(high3).to.be.gt(high2)

      await advanceToTimestamp((await getLatestBlockTimestamp()) + 12)
      const [low4, high4] = await morphoAsset.price()
      expect(low4).to.be.lt(low3)
      expect(high4).to.be.gt(high3)

      await advanceTime(PRICE_TIMEOUT.toNumber())
      const [low5, high5] = await morphoAsset.price()
      expect(low5).to.equal(bn(0))
      expect(high5).to.equal(MAX_UINT192)
    })

    it('lotPrice (deprecated) equals price()', async () => {
      const lotPrice = await morphoAsset.lotPrice()
      const price = await morphoAsset.price()
      expect(price.length).to.equal(2)
      expect(lotPrice.length).to.equal(price.length)
      expect(lotPrice[0]).to.equal(price[0])
      expect(lotPrice[1]).to.equal(price[1])
    })
  })
})
