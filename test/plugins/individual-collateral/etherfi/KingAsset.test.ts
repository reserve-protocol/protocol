import { expect } from 'chai'
import { Wallet, ContractFactory, BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { networkConfig } from '../../../../common/configuration'
import { getChainId } from '../../../../common/blockchain-utils'
import { advanceTime, getLatestBlockTimestamp, advanceToTimestamp } from '../../../utils/time'
import { ZERO_ADDRESS, ONE_ADDRESS, MAX_UINT192 } from '../../../../common/constants'
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
  Asset,
  InvalidMockV3Aggregator,
  KingAsset,
  ERC20Mock,
  UnpricedKingAssetMock,
  MockV3Aggregator,
} from '../../../../typechain'
import { VERSION } from '../../../fixtures'
import { useEnv } from '#/utils/env'
import {
  KING,
  ETH_USD_PRICE_FEED,
  ETH_ORACLE_ERROR,
  ETH_ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  FORK_BLOCK,
} from './constants'

let chainId: string

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
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

const describeFork = useEnv('FORK') ? describe : describe.skip

const MAX_TRADE_VOLUME = fp('1e6')
const DECAY_DELAY = ETH_ORACLE_TIMEOUT.add(310)

describeFork('King Asset #fast', () => {
  // Tokens
  let king: ERC20Mock

  // Assets
  let kingAsset: KingAsset

  // Main
  let wallet: Wallet

  // Factory
  let KingAssetFactory: ContractFactory

  // Oracle
  let ethUsdOracle: MockV3Aggregator

  // ETH/USD price
  let ethPrice: BigNumber

  before(async () => {
    await setup(FORK_BLOCK)
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]

    chainId = await getChainId(hre)

    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    await setup(FORK_BLOCK)

    // Set King token
    king = await ethers.getContractAt('ERC20Mock', KING)

    // Get ETH/USD price from oracle
    const ethOracle = await ethers.getContractAt('AggregatorV3Interface', ETH_USD_PRICE_FEED)
    ethPrice = (await ethOracle.latestRoundData()).answer

    // Deploy MockV3Aggregator
    const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    ethUsdOracle = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, ethPrice)
    await ethUsdOracle.deployed()

    // Update answer to set fresh timestamp
    await ethUsdOracle.updateAnswer(ethPrice)

    // Deploy KingAsset
    KingAssetFactory = await ethers.getContractFactory('KingAsset')
    kingAsset = <KingAsset>(
      await KingAssetFactory.deploy(
        PRICE_TIMEOUT,
        ethUsdOracle.address,
        ETH_ORACLE_ERROR,
        king.address,
        MAX_TRADE_VOLUME,
        ETH_ORACLE_TIMEOUT
      )
    )
    await kingAsset.deployed()
    await kingAsset.refresh()
  })

  describe('Deployment', () => {
    it('Deployment should setup King asset correctly', async () => {
      // KING Asset
      expect(await kingAsset.isCollateral()).to.equal(false)
      expect(await kingAsset.erc20()).to.equal(king.address)
      expect(await king.decimals()).to.equal(18)
      expect(await kingAsset.version()).to.equal(VERSION)
      expect(await kingAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOLUME)
      // price is approx $506 usd at block 23841545
      await expectPrice(kingAsset.address, fp('506.18'), ETH_ORACLE_ERROR, true, bn('1e4'))
      await expect(kingAsset.claimRewards()).to.not.emit(kingAsset, 'RewardsClaimed')
    })
  })

  describe('Prices', () => {
    it('Should increase price when ETH/USD price increases', async () => {
      // Get initial prices
      const [initialLow, initialHigh] = await kingAsset.price()

      // Increase Eth/USD Oracle price
      const newEthPrice = ethPrice.mul(110).div(100)
      await setOraclePrice(kingAsset.address, newEthPrice)

      // Get new prices
      const [newLow, newHigh] = await kingAsset.price()

      // Verify prices increased (both low and high)
      expect(newLow).to.be.gt(initialLow)
      expect(newHigh).to.be.gt(initialHigh)
    })

    it('Should become unpriced if price is zero', async () => {
      const kingInitPrice = await kingAsset.price()

      // Update values in Oracles to 0
      await setOraclePrice(kingAsset.address, bn('0'))

      // Fallback prices should be initial prices
      await expectExactPrice(kingAsset.address, kingInitPrice)

      // Advance past oracle timeout
      await advanceTime(DECAY_DELAY.add(1).toString())
      await setOraclePrice(kingAsset.address, bn('0'))
      await kingAsset.refresh()

      // Prices should be decaying
      await expectDecayedPrice(kingAsset.address)

      // After price timeout, should be unpriced
      await advanceTime(PRICE_TIMEOUT.toString())
      await setOraclePrice(kingAsset.address, bn('0'))

      // Should be unpriced now
      await expectUnpriced(kingAsset.address)
    })

    it('Should calculate trade min correctly', async () => {
      // Check initial values
      expect(await kingAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOLUME)

      //  Reduce price - maintains max size
      await setOraclePrice(kingAsset.address, ethPrice.div(2)) // half
      expect(await kingAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOLUME)
    })

    it('Should remain at saved price if oracle is stale', async () => {
      // Save initial price
      const initialPrice = await kingAsset.price()

      await advanceTime(DECAY_DELAY.sub(12).toString())

      // lastSave should not be block timestamp after refresh
      await kingAsset.refresh()
      expect(await kingAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())

      // Check price is still at saved price
      await expectExactPrice(kingAsset.address, initialPrice)
    })

    it('Should remain at saved price in case of invalid timestamp', async () => {
      // Save initial price
      const initialPrice = await kingAsset.price()

      await setInvalidOracleTimestamp(kingAsset.address)

      // lastSave should not be block timestamp after refresh
      await kingAsset.refresh()
      expect(await kingAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())

      // Check price is still at saved price
      await expectExactPrice(kingAsset.address, initialPrice)
    })

    it('Should remain at saved price in case of invalid answered round', async () => {
      // Save initial price
      const initialPrice = await kingAsset.price()

      await setInvalidOracleAnsweredRound(kingAsset.address)

      // lastSave should not be block timestamp after refresh
      await kingAsset.refresh()
      expect(await kingAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())

      // Check price is still at saved price
      await expectExactPrice(kingAsset.address, initialPrice)
    })

    it('Should be able to refresh saved prices', async () => {
      // Check initial prices
      let currBlockTimestamp: number = await getLatestBlockTimestamp()
      let [lowPrice, highPrice] = await kingAsset.price()
      expect(await kingAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(highPrice)
      expect(await kingAsset.lastSave()).to.equal(currBlockTimestamp)

      // Refresh saved prices again
      await kingAsset.refresh()

      // Check values remain but timestamp was updated
      const [lowPrice2, highPrice2] = await kingAsset.price()
      expect(lowPrice2).to.equal(lowPrice)
      expect(highPrice2).to.equal(highPrice)
      expect(await kingAsset.savedLowPrice()).to.equal(lowPrice2)
      expect(await kingAsset.savedHighPrice()).to.equal(highPrice2)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await kingAsset.lastSave()).to.equal(currBlockTimestamp)

      // Increase Eth/USD Oracle price
      const newEthPrice = ethPrice.mul(120).div(100)
      await setOraclePrice(kingAsset.address, newEthPrice)

      // Before calling refresh we still have the old saved values
      ;[lowPrice, highPrice] = await kingAsset.price()
      expect(await kingAsset.savedLowPrice()).to.be.lt(lowPrice)
      expect(await kingAsset.savedHighPrice()).to.be.lt(highPrice)

      // Refresh prices - Should save new values
      await kingAsset.refresh()

      // Check new prices were stored
      ;[lowPrice, highPrice] = await kingAsset.price()
      expect(await kingAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(highPrice)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await kingAsset.lastSave()).to.equal(currBlockTimestamp)

      expect(lowPrice).to.be.gt(lowPrice2)
      expect(highPrice).to.be.gt(highPrice2)
    })

    it('Should not save prices if try/price returns unpriced', async () => {
      const UnpricedKingAssetFactory = await ethers.getContractFactory('UnpricedKingAssetMock')
      const unpricedKingAsset: UnpricedKingAssetMock = <UnpricedKingAssetMock>(
        await UnpricedKingAssetFactory.deploy(
          PRICE_TIMEOUT,
          await kingAsset.chainlinkFeed(),
          ETH_ORACLE_ERROR,
          king.address,
          MAX_TRADE_VOLUME,
          ETH_ORACLE_TIMEOUT
        )
      )

      // Save prices
      await unpricedKingAsset.refresh()

      // Check initial prices
      let currBlockTimestamp: number = await getLatestBlockTimestamp()
      let [lowPrice, highPrice] = await unpricedKingAsset.price()
      expect(await unpricedKingAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await unpricedKingAsset.savedHighPrice()).to.equal(highPrice)
      expect(await unpricedKingAsset.lastSave()).to.be.equal(currBlockTimestamp)

      // Refresh saved prices
      await unpricedKingAsset.refresh()

      // Check values remain but timestamp was updated
      const [lowPrice2, highPrice2] = await unpricedKingAsset.price()
      expect(lowPrice2).to.equal(lowPrice)
      expect(highPrice2).to.equal(highPrice)
      ;[lowPrice, highPrice] = await unpricedKingAsset.price()
      expect(await unpricedKingAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await unpricedKingAsset.savedHighPrice()).to.equal(highPrice)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await unpricedKingAsset.lastSave()).to.equal(currBlockTimestamp)

      // Set as unpriced so it returns 0,FIX MAX in try/price
      await unpricedKingAsset.setUnpriced(true)

      // Check that now is unpriced
      await expectUnpriced(unpricedKingAsset.address)

      // Refreshing would not save the new rates
      await unpricedKingAsset.refresh()
      expect(await unpricedKingAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await unpricedKingAsset.savedHighPrice()).to.equal(highPrice)
      expect(await unpricedKingAsset.lastSave()).to.equal(currBlockTimestamp)
    })

    it('Should not revert on refresh if stale', async () => {
      // Check initial prices
      const startBlockTimestamp: number = await getLatestBlockTimestamp()
      const [prevLowPrice, prevHighPrice] = await kingAsset.price()
      await expectPrice(kingAsset.address, fp('506.18'), ETH_ORACLE_ERROR, true, bn('1e4'))
      expect(await kingAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await kingAsset.lastSave()).to.equal(startBlockTimestamp)

      // Set invalid oracle
      await setInvalidOracleTimestamp(kingAsset.address)

      // Check price - uses still previous prices
      await kingAsset.refresh()
      let [lowPrice, highPrice] = await kingAsset.price()
      expect(lowPrice).to.equal(prevLowPrice)
      expect(highPrice).to.equal(prevHighPrice)
      expect(await kingAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await kingAsset.lastSave()).to.equal(startBlockTimestamp)

      // Check price - no update on prices/timestamp
      await kingAsset.refresh()
      ;[lowPrice, highPrice] = await kingAsset.price()
      expect(lowPrice).to.equal(prevLowPrice)
      expect(highPrice).to.equal(prevHighPrice)
      expect(await kingAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await kingAsset.lastSave()).to.equal(startBlockTimestamp)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidKingAsset: Asset = <Asset>(
        await KingAssetFactory.deploy(
          PRICE_TIMEOUT,
          invalidChainlinkFeed.address,
          ETH_ORACLE_ERROR,
          king.address,
          MAX_TRADE_VOLUME,
          ETH_ORACLE_TIMEOUT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidKingAsset.price()).to.be.reverted
      await expect(invalidKingAsset.refresh()).to.be.reverted

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidKingAsset.price()).to.be.reverted
      await expect(invalidKingAsset.refresh()).to.be.reverted
    })

    it('Bubbles error up if Chainlink feed reverts for explicit reason', async () => {
      // Applies to all collateral as well
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidKingAsset: Asset = <Asset>(
        await KingAssetFactory.deploy(
          PRICE_TIMEOUT,
          invalidChainlinkFeed.address,
          ETH_ORACLE_ERROR,
          king.address,
          MAX_TRADE_VOLUME,
          ETH_ORACLE_TIMEOUT
        )
      )

      // Reverting with reason
      await invalidChainlinkFeed.setRevertWithExplicitError(true)
      await expect(invalidKingAsset.tryPrice()).to.be.revertedWith('oracle explicit error')
    })

    it('Should handle price decay correctly', async () => {
      await kingAsset.refresh()

      // Check prices
      const startBlockTimestamp: number = await getLatestBlockTimestamp()
      const [prevLowPrice, prevHighPrice] = await kingAsset.price()
      expect(await kingAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await kingAsset.lastSave()).to.equal(startBlockTimestamp)

      // Set invalid oracle
      await setInvalidOracleTimestamp(kingAsset.address)

      // Check unpriced - uses still previous prices
      const [lowPrice, highPrice] = await kingAsset.price()
      expect(lowPrice).to.equal(prevLowPrice)
      expect(highPrice).to.equal(prevHighPrice)
      expect(await kingAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await kingAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await kingAsset.lastSave()).to.equal(startBlockTimestamp)

      // At first price doesn't decrease
      const [lowPrice2, highPrice2] = await kingAsset.price()
      expect(lowPrice2).to.eq(lowPrice)
      expect(highPrice2).to.eq(highPrice)

      // Advance past oracleTimeout
      await advanceTime(DECAY_DELAY.toString())

      // Now price widens
      const [lowPrice3, highPrice3] = await kingAsset.price()
      expect(lowPrice3).to.be.lt(lowPrice2)
      expect(highPrice3).to.be.gt(highPrice2)

      // Advance block, price keeps widening
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 12)
      const [lowPrice4, highPrice4] = await kingAsset.price()
      expect(lowPrice4).to.be.lt(lowPrice3)
      expect(highPrice4).to.be.gt(highPrice3)

      // Advance blocks beyond PRICE_TIMEOUT; price should be [O, FIX_MAX]
      await advanceTime(PRICE_TIMEOUT.toNumber())

      // Lot price returns 0 once time elapses
      const [lowPrice5, highPrice5] = await kingAsset.price()
      expect(lowPrice5).to.be.lt(lowPrice4)
      expect(highPrice5).to.be.gt(highPrice4)
      expect(lowPrice5).to.be.equal(bn(0))
      expect(highPrice5).to.be.equal(MAX_UINT192)
    })

    it('lotPrice (deprecated) is equal to price()', async () => {
      for (const asset of [kingAsset]) {
        const lotPrice = await asset.lotPrice()
        const price = await asset.price()
        expect(price.length).to.equal(2)
        expect(lotPrice.length).to.equal(price.length)
        expect(lotPrice[0]).to.equal(price[0])
        expect(lotPrice[1]).to.equal(price[1])
      }
    })
  })

  describe('Constructor validation', () => {
    it('Should not allow price timeout to be zero', async () => {
      await expect(
        KingAssetFactory.deploy(0, ONE_ADDRESS, 0, ONE_ADDRESS, MAX_TRADE_VOLUME, 0)
      ).to.be.revertedWith('price timeout zero')
    })
    it('Should not allow missing chainlink feed', async () => {
      await expect(
        KingAssetFactory.deploy(1, ZERO_ADDRESS, 0, ONE_ADDRESS, MAX_TRADE_VOLUME, 1)
      ).to.be.revertedWith('missing chainlink feed')
    })
    it('Should not allow missing erc20', async () => {
      await expect(
        KingAssetFactory.deploy(1, ONE_ADDRESS, 1, ZERO_ADDRESS, MAX_TRADE_VOLUME, 1)
      ).to.be.revertedWith('missing erc20')
    })
    it('Should not allow 0 oracleError', async () => {
      await expect(
        KingAssetFactory.deploy(1, ONE_ADDRESS, 0, ONE_ADDRESS, MAX_TRADE_VOLUME, 1)
      ).to.be.revertedWith('oracle error out of range')
    })
    it('Should not allow FIX_ONE oracleError', async () => {
      await expect(
        KingAssetFactory.deploy(1, ONE_ADDRESS, fp('1'), ONE_ADDRESS, MAX_TRADE_VOLUME, 1)
      ).to.be.revertedWith('oracle error out of range')
    })
    it('Should not allow 0 oracleTimeout', async () => {
      await expect(
        KingAssetFactory.deploy(1, ONE_ADDRESS, 1, ONE_ADDRESS, MAX_TRADE_VOLUME, 0)
      ).to.be.revertedWith('oracleTimeout zero')
    })
    it('Should not allow maxTradeVolume to be zero', async () => {
      await expect(
        KingAssetFactory.deploy(1, ONE_ADDRESS, 1, ONE_ADDRESS, 0, 1)
      ).to.be.revertedWith('invalid max trade volume')
    })
  })
})
