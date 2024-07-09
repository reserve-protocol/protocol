import { loadFixture, setCode } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import {
  Collateral,
  IMPLEMENTATION,
  Implementation,
  SLOW,
  ORACLE_ERROR,
  DECAY_DELAY,
  PRICE_TIMEOUT,
  defaultFixture, // intentional
} from '../fixtures'
import { bn, fp, shortString, divCeil } from '../../common/numbers'
import { expectEvents } from '../../common/events'
import { IConfig, networkConfig } from '../../common/configuration'
import {
  BN_SCALE_FACTOR,
  CollateralStatus,
  TradeKind,
  QUEUE_START,
  MAX_UINT48,
  MAX_UINT96,
  MAX_UINT192,
  ONE_ADDRESS,
  PAUSER,
  ZERO_ADDRESS,
} from '../../common/constants'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { expectTrade, getAuctionId, getTrade } from '../utils/trades'
import { setOraclePrice } from '../utils/oracles'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '../utils/impersonation'
import { expectRTokenPrice } from '../utils/oracles'
import { withinTolerance } from '../utils/matchers'
import { cartesianProduct } from '../utils/cases'
import {
  EasyAuction,
  ERC20Mock,
  FacadeTest,
  FiatCollateral,
  IAssetRegistry,
  RTokenAsset,
  TestIBackingManager,
  TestIBasketHandler,
  TestIBroker,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
} from '../../typechain'
import { useEnv } from '#/utils/env'

const describeFork = useEnv('FORK') ? describe : describe.skip

const describeExtreme =
  IMPLEMENTATION == Implementation.P1 && useEnv('EXTREME') && useEnv('FORK')
    ? describe.only
    : describe.skip

describeFork(`Gnosis EasyAuction Mainnet Forking - P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let config: IConfig

  let rsr: ERC20Mock
  let stRSR: TestIStRSR
  let rToken: TestIRToken
  let broker: TestIBroker
  let backingManager: TestIBackingManager
  let rsrTrader: TestIRevenueTrader
  let basketHandler: TestIBasketHandler
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry

  let easyAuction: EasyAuction

  let basket: Collateral[]
  let collateral: Collateral[]
  let collateral0: FiatCollateral
  let token0: ERC20Mock
  let token1: ERC20Mock
  let rTokenAsset: RTokenAsset

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    let erc20s: ERC20Mock[]
    ;({
      assetRegistry,
      basket,
      config,
      rToken,
      erc20s,
      stRSR,
      broker,
      rsr,
      collateral,
      easyAuction,
      facadeTest,
      backingManager,
      rsrTrader,
      basketHandler,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
    token1 = <ERC20Mock>erc20s[collateral.indexOf(basket[1])]
    collateral0 = <FiatCollateral>collateral[0]
  })

  context('RSR -> token0', function () {
    let issueAmount: BigNumber
    let sellAmt: BigNumber
    let buyAmt: BigNumber
    let auctionId: BigNumber

    // Set up an auction of 10_000e18 RSR for token0
    beforeEach(async function () {
      issueAmount = fp('10000')
      buyAmt = issueAmount.add(2) // from prepareTradeToCoverDeficit rounding

      // Set prime basket
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Issue
      await token0.connect(owner).mint(addr1.address, issueAmount)
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Seed excess stake
      await rsr.connect(owner).mint(addr1.address, issueAmount.mul(1e9))
      await rsr.connect(addr1).approve(stRSR.address, issueAmount.mul(1e9))
      await stRSR.connect(addr1).stake(issueAmount.mul(1e9))

      // Check initial state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

      // Take backing
      await token0.connect(owner).burn(backingManager.address, issueAmount)

      // Prepare addr1/addr2 for trading
      expect(await token0.balanceOf(addr1.address)).to.equal(0)
      await token0.connect(owner).mint(addr1.address, issueAmount.mul(1e9))
      await token0.connect(owner).mint(addr2.address, issueAmount.mul(1e9))

      // Create auction
      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION))
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(anyValue, rsr.address, token0.address, anyValue, withinTolerance(buyAmt))

      const t = await getTrade(backingManager, rsr.address)
      sellAmt = await t.initBal()

      const auctionTimestamp: number = await getLatestBlockTimestamp()
      auctionId = await getAuctionId(backingManager, rsr.address)

      // Check auction registered
      // RSR -> Token0 Auction
      await expectTrade(backingManager, {
        sell: rsr.address,
        buy: token0.address,
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: auctionId,
      })

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check Gnosis
      expect(await rsr.balanceOf(easyAuction.address)).to.equal(sellAmt)
      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
        'already rebalancing'
      )

      // Auction should not be able to be settled
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted
    })

    afterEach(async () => {
      // Should not trigger a de-listing of the auction platform
      expect(await broker.batchTradeDisabled()).to.equal(false)

      // Should not be able to re-bid in auction
      await token0.connect(addr2).approve(easyAuction.address, buyAmt)
      await expect(
        easyAuction
          .connect(addr2)
          .placeSellOrders(
            auctionId,
            [sellAmt.div(2)],
            [buyAmt],
            [QUEUE_START],
            ethers.constants.HashZero
          )
      ).to.be.reverted

      // Should not be able to re-settle
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted
    })

    it('no volume', async () => {
      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction, should restart
      await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, 0, 0],
          emitted: true,
        },
        {
          contract: backingManager,
          name: 'TradeStarted',
          args: [anyValue, rsr.address, token0.address, sellAmt, buyAmt],
          emitted: true,
        },
      ])
    })

    it('partial volume -- asking price', async () => {
      const bidAmt = buyAmt.div(2).add(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(
          auctionId,
          [sellAmt.div(2)],
          [bidAmt],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt.div(2).add(1), bidAmt.sub(1)],
          emitted: true,
        },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bidAmt.sub(1))
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt.sub(1))
      expect(await token0.balanceOf(easyAuction.address)).to.equal(1) // remainder
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(sellAmt.div(2))
    })

    it('partial volume -- worst-case price', async () => {
      const bidAmt = buyAmt.div(2).add(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(
          auctionId,
          [sellAmt.div(2)],
          [bidAmt],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt.div(2).add(1), bidAmt.sub(1)],
          emitted: true,
        },
      ])

      // Check state - Should be undercollateralized
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt.sub(1))
      expect(await token0.balanceOf(easyAuction.address)).to.equal(1) // remainder
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(sellAmt.div(2))
    })

    it('full volume -- asking price', async () => {
      const bidAmt = sellAmt.add(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(auctionId, [sellAmt], [bidAmt], [QUEUE_START], ethers.constants.HashZero)

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })

    it('full volume -- worst-case price', async () => {
      const bidAmt = buyAmt.add(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(auctionId, [sellAmt], [bidAmt], [QUEUE_START], ethers.constants.HashZero)

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Should be undercollateralized
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })

    it('full volume -- bid at 2x price', async () => {
      const bidAmt = buyAmt.add(1)
      sellAmt = sellAmt.div(2)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(auctionId, [sellAmt], [bidAmt], [QUEUE_START], ethers.constants.HashZero)

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction -- should trade at lower worst-case price
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt.mul(2).add(1), bidAmt],
          emitted: true,
        },
      ])

      // Check state - Should be undercollateralized
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })

    it('full volume -- with fees', async () => {
      const chainId = await getChainId(hre)
      const easyAuctionOwner = networkConfig[chainId].EASY_AUCTION_OWNER || ''

      // Apply 0.1% fee
      await whileImpersonating(easyAuctionOwner, async (auctionOwner) => {
        await easyAuction.connect(auctionOwner).setFeeParameters(1, easyAuctionOwner)
      })

      const adjSellAmt = sellAmt.mul(1000).div(1001)
      const bidAmt = buyAmt
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(
          auctionId,
          [adjSellAmt],
          [bidAmt],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })

    it('/w non-trivial prices', async () => {
      // End first auction, since it is at old prices
      await advanceTime(config.batchAuctionLength.add(100).toString())
      await backingManager.settleTrade(rsr.address)

      // $0.007 RSR at $4k ETH
      const rsrPrice = bn('0.007e8')
      await setOraclePrice(await assetRegistry.toAsset(rsr.address), rsrPrice)
      // sellAmt = BigNumber.from(config.rTokenMaxTradeVolume)

      // Fix backing in a single auction, since it all fits inside the $1M maxTradeVolume
      buyAmt = issueAmount.add(1) // rounding up from prepareTradeToCoverDeficit

      // Start next auction
      await expectEvents(backingManager.rebalance(TradeKind.BATCH_AUCTION), [
        {
          contract: backingManager,
          name: 'TradeStarted',
          args: [anyValue, rsr.address, token0.address, anyValue, buyAmt],
          emitted: true,
        },
      ])

      const t = await getTrade(backingManager, rsr.address)
      sellAmt = await t.initBal()
      expect(sellAmt).to.be.closeTo(fp('1.472e6'), fp('0.001e6'))

      const bidAmt = buyAmt.add(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(
          auctionId.add(1),
          [sellAmt],
          [bidAmt],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })

    it('/w someone else settling the auction for us', async () => {
      const bidAmt = sellAmt.add(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(auctionId, [sellAmt], [bidAmt], [QUEUE_START], ethers.constants.HashZero)

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // Settle auction directly
      await easyAuction.connect(addr2).settleAuction(auctionId)

      // End current auction, should behave same as if the protocol did the settlement
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })
  })

  context('token0 -> RSR; boundary cases', function () {
    let issueAmount: BigNumber

    // Set up a basket of just token0
    beforeEach(async function () {
      issueAmount = bn('10000e18')

      // Set prime basket
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
          token0.address,
          token1.address,
        ])
      await basketHandler.connect(owner).refreshBasket()
      await token0.mint(rsrTrader.address, issueAmount)
    })

    it('should be able to scoop entire auction cheaply when minBuyAmount = 0', async () => {
      // Make collateral0 price (0, FIX_MAX)
      await setOraclePrice(collateral0.address, bn('0'))
      await collateral0.refresh()
      await advanceTime(PRICE_TIMEOUT.add(DECAY_DELAY).toString())
      await setOraclePrice(collateral0.address, bn('0'))
      await setOraclePrice(await assetRegistry.toAsset(rsr.address), bn('1e8'))

      // force a revenue dust auction
      await expect(rsrTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])).to.emit(
        rsrTrader,
        'TradeStarted'
      )

      const auctionTimestamp: number = await getLatestBlockTimestamp()
      const auctionId = await getAuctionId(rsrTrader, token0.address)

      // Check auction opened even at minBuyAmount = 0
      await expectTrade(rsrTrader, {
        sell: token0.address,
        buy: rsr.address,
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: auctionId,
      })
      const trade = await getTrade(rsrTrader, token0.address)
      expect(await trade.status()).to.equal(1) // TradeStatus.OPEN

      // Auction should not be able to be settled
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted

      await rsr.mint(addr1.address, issueAmount)
      await rsr.connect(addr1).approve(easyAuction.address, issueAmount)

      // Bid with a nontheless pretty small order, and succeed.
      const bidAmt = (await trade.DEFAULT_MIN_BID()).add(1)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(
          auctionId,
          [issueAmount],
          [bidAmt],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(rsrTrader.settleTrade(token0.address), [
        {
          contract: rsrTrader,
          name: 'TradeSettled',
          args: [anyValue, token0.address, rsr.address, issueAmount, bidAmt],
          emitted: true,
        },
      ])
    })

    it('should handle fees in EasyAuction correctly', async () => {
      const chainId = await getChainId(hre)
      const easyAuctionOwner = networkConfig[chainId].EASY_AUCTION_OWNER || ''

      // No fees yet transferred to Easy auction owner
      expect(await token0.balanceOf(easyAuctionOwner)).to.equal(0)

      // Set fees in easy auction to 1%
      await whileImpersonating(easyAuctionOwner, async (auctionOwner) => {
        await easyAuction.connect(auctionOwner).setFeeParameters(10, easyAuctionOwner)
      })

      // Calculate values
      const feeDenominator = await easyAuction.FEE_DENOMINATOR()
      const feeNumerator = await easyAuction.feeNumerator()
      const actualSellAmount = issueAmount.mul(feeDenominator).div(feeDenominator.add(feeNumerator))
      const feeAmt = issueAmount.sub(actualSellAmount)

      await setOraclePrice(collateral0.address, bn('0.5e8')) // depeg

      // force a revenue dust auction
      await expect(rsrTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])).to.emit(
        rsrTrader,
        'TradeStarted'
      )

      const auctionTimestamp: number = await getLatestBlockTimestamp()
      const auctionId = await getAuctionId(rsrTrader, token0.address)

      // Check auction opened even at minBuyAmount = 0
      await expectTrade(rsrTrader, {
        sell: token0.address,
        buy: rsr.address,
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: auctionId,
      })
      const trade = await getTrade(rsrTrader, token0.address)
      expect(await trade.status()).to.equal(1) // TradeStatus.OPEN

      // Check Gnosis
      expect(await token0.balanceOf(easyAuction.address)).to.be.closeTo(issueAmount, 1)
      await expect(
        rsrTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])
      ).to.be.revertedWith('trade open')

      // Auction should not be able to be settled
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted

      await rsr.mint(addr1.address, issueAmount)
      await rsr.connect(addr1).approve(easyAuction.address, issueAmount)

      // Bid order
      const bidAmt = issueAmount
      await easyAuction
        .connect(addr1)
        .placeSellOrders(
          auctionId,
          [issueAmount],
          [bidAmt],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction
      await expectEvents(rsrTrader.settleTrade(token0.address), [
        {
          contract: rsrTrader,
          name: 'TradeSettled',
          args: [anyValue, token0.address, rsr.address, issueAmount.sub(1), actualSellAmount], // Account for rounding
          emitted: true,
        },
      ])

      expect(await token0.balanceOf(easyAuctionOwner)).to.be.closeTo(feeAmt, 1) // account for rounding
    })
  })

  describe(`Trading limitations`, () => {
    it('EasyAuction reverts when sum of bids > type(uint96).max', async () => {
      const sellAmount = fp('1')
      const endTime = (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength)
      const minBuyAmount = MAX_UINT96.sub(1)

      // Mints tokens
      await token0.connect(owner).mint(owner.address, sellAmount)
      await token1.connect(owner).mint(addr1.address, MAX_UINT96)
      await token1.connect(owner).mint(addr2.address, MAX_UINT96)

      // Start auction
      await token0.connect(owner).approve(easyAuction.address, sellAmount)

      // Get auction Id
      const auctionId = await easyAuction.callStatic.initiateAuction(
        token0.address,
        token1.address,
        endTime,
        endTime,
        sellAmount,
        minBuyAmount,
        1,
        0,
        false,
        ZERO_ADDRESS,
        new Uint8Array(0)
      )

      // Initiate auction
      await easyAuction.initiateAuction(
        token0.address,
        token1.address,
        endTime,
        endTime,
        sellAmount,
        minBuyAmount,
        1,
        0,
        false,
        ZERO_ADDRESS,
        new Uint8Array(0)
      )

      // Perform first bid
      await token1.connect(addr1).approve(easyAuction.address, minBuyAmount.sub(1))
      await easyAuction.connect(addr1).placeSellOrders(
        auctionId,
        [1],
        [minBuyAmount.sub(1)], // falls short
        [QUEUE_START],
        ethers.constants.HashZero
      )

      // Perform second bid
      await token1.connect(addr2).approve(easyAuction.address, minBuyAmount)
      await easyAuction.connect(addr2).placeSellOrders(
        auctionId,
        [1],
        [minBuyAmount.sub(1)], // Sum will exceed uint96.MAX
        [QUEUE_START],
        ethers.constants.HashZero
      )

      // Attempt to settle - should revert
      await advanceTime(config.batchAuctionLength.add(100).toString())
      await expect(easyAuction.settleAuction(auctionId)).to.be.revertedWith(
        "SafeCast: value doesn't fit in 96 bits"
      )
    })
  })

  describeExtreme(`Extreme Values ${SLOW ? 'slow mode' : 'fast mode'}`, () => {
    if (!(Implementation.P1 && useEnv('EXTREME') && useEnv('FORK'))) return // prevents bunch of skipped tests

    async function runScenario([
      sellTokDecimals,
      buyTokDecimals,
      auctionSellAmt,
      price,
      fill,
    ]: BigNumber[]) {
      const auctionBuyAmt = divCeil(auctionSellAmt.mul(price), BN_SCALE_FACTOR)
      const bidSellAmt = auctionSellAmt.mul(fill).div(BN_SCALE_FACTOR)
      const bidBuyAmt = divCeil(bidSellAmt.mul(price), BN_SCALE_FACTOR).add(1)

      // Factories
      const ERC20Factory = await ethers.getContractFactory('ERC20MockDecimals')
      const CollFactory = await ethers.getContractFactory('FiatCollateral')
      const MainFactory = await ethers.getContractFactory('MainP0')
      const BrokerFactory = await ethers.getContractFactory('BrokerP0')
      const GnosisTradeFactory = await ethers.getContractFactory('GnosisTrade')
      const DutchTradeFactory = await ethers.getContractFactory('DutchTrade')

      // Deployments
      const main = await MainFactory.deploy()
      const broker = await BrokerFactory.deploy()
      const gnosisTradeImpl = await GnosisTradeFactory.deploy()
      const dutchTradeImpl = await DutchTradeFactory.deploy()
      await main.init(
        {
          rToken: ONE_ADDRESS,
          stRSR: ONE_ADDRESS,
          assetRegistry: ONE_ADDRESS,
          basketHandler: ONE_ADDRESS,
          backingManager: addr1.address, // use addr1 to impersonate backingManager
          distributor: ONE_ADDRESS,
          furnace: ONE_ADDRESS,
          broker: broker.address,
          rsrTrader: ONE_ADDRESS,
          rTokenTrader: ONE_ADDRESS,
        },
        rsr.address,
        1,
        1
      )
      // Set pauser and unpause
      await main.connect(owner).grantRole(PAUSER, owner.address)
      await main.connect(owner).unpauseTrading()
      await main.connect(owner).unpauseIssuance()
      await broker.init(
        main.address,
        easyAuction.address,
        gnosisTradeImpl.address,
        config.batchAuctionLength,
        dutchTradeImpl.address,
        config.dutchAuctionLength
      )
      const sellTok = await ERC20Factory.deploy('Sell Token', 'SELL', sellTokDecimals)
      const buyTok = await ERC20Factory.deploy('Buy Token', 'BUY', buyTokDecimals)
      const sellColl = <FiatCollateral>await CollFactory.deploy({
        priceTimeout: MAX_UINT48,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: ORACLE_ERROR, // shouldn't matter
        erc20: sellTok.address,
        maxTradeVolume: MAX_UINT192,
        oracleTimeout: MAX_UINT48.sub(300),
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01'), // shouldn't matter
        delayUntilDefault: bn('604800'), // shouldn't matter
      })
      await sellColl.refresh()
      const buyColl = <FiatCollateral>await CollFactory.deploy({
        priceTimeout: MAX_UINT48,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: ORACLE_ERROR, // shouldn't matter
        erc20: buyTok.address,
        maxTradeVolume: MAX_UINT192,
        oracleTimeout: MAX_UINT48.sub(300),
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01'), // shouldn't matter
        delayUntilDefault: bn('604800'), // shouldn't matter
      })
      await buyColl.refresh()

      // Issue tokens to addr1
      const MAX_ERC20_SUPPLY = bn('1e48') // from docs/solidity-style.md
      await sellTok.connect(owner).mint(addr1.address, MAX_ERC20_SUPPLY)
      await buyTok.connect(owner).mint(addr1.address, MAX_ERC20_SUPPLY)

      // First simulate opening the trade to get where it will be deployed
      await sellTok.connect(addr1).approve(broker.address, auctionSellAmt)
      const prices = { sellLow: fp('1'), sellHigh: fp('1'), buyLow: fp('1'), buyHigh: fp('1') }
      const tradeAddr = await broker.connect(addr1).callStatic.openTrade(
        TradeKind.BATCH_AUCTION,
        {
          sell: sellColl.address,
          buy: buyColl.address,
          sellAmount: auctionSellAmt,
          minBuyAmount: auctionBuyAmt,
        },
        prices
      )
      // Start auction!
      await broker.connect(addr1).openTrade(
        TradeKind.BATCH_AUCTION,
        {
          sell: sellColl.address,
          buy: buyColl.address,
          sellAmount: auctionSellAmt,
          minBuyAmount: auctionBuyAmt,
        },
        prices
      )

      // Get auctionId
      const trade = await ethers.getContractAt('GnosisTrade', tradeAddr)
      const auctionId = await trade.auctionId()

      // Bid if above minBuyAmtPerOrder
      const DEFAULT_MIN_BID = await trade.DEFAULT_MIN_BID()
      const minBuyAmount = auctionBuyAmt.gt(0) ? auctionBuyAmt : bn('1')
      let minBuyAmtPerOrder = DEFAULT_MIN_BID.mul(bn(10).pow(await buyTok.decimals())).div(
        BN_SCALE_FACTOR
      )
      const minBuyAmtFloor = minBuyAmount.div(await trade.MAX_ORDERS())
      if (minBuyAmtFloor.gt(minBuyAmtPerOrder)) minBuyAmtPerOrder = minBuyAmtFloor
      if (minBuyAmtPerOrder.eq(bn('0'))) minBuyAmtPerOrder = bn('1')

      if (bidSellAmt.gt(0) && bidBuyAmt.gte(minBuyAmtPerOrder)) {
        await buyTok.connect(addr1).approve(easyAuction.address, bidBuyAmt)
        await easyAuction
          .connect(addr1)
          .placeSellOrders(
            auctionId,
            [bidSellAmt],
            [bidBuyAmt],
            [QUEUE_START],
            ethers.constants.HashZero
          )
      }

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End Auction
      await expect(trade.connect(addr1).settle()).to.not.emit(broker, 'BatchTradeDisabledSet')
      expect(await broker.batchTradeDisabled()).to.equal(false)
    }

    // ==== Generate the tests ====

    // applied to both buy and sell tokens
    const decimals = [bn('1'), bn('6'), bn('8'), bn('9'), bn('18'), bn('21'), bn('27')]

    // auction sell amount
    const auctionSellAmts = [bn('1'), bn('1595439874635'), bn('987321984732198435645846513')]

    // price ratios: use disgustingly precise values here to test weird roundings
    const priceRatios = [
      fp('0.793549493549843521'),
      fp('1.372369387462958574'),
      fp('2.298432198935249846'),
    ]

    // auction fill %: use disgustingly precise values here to test weird roundings
    const fill = [fp('0'), fp('0.321698432589749813'), fp('0.798138321987329646'), fp('1')]

    // total cases is 5 * 5 * 3 * 3 * 4 = 900

    if (SLOW) {
      auctionSellAmts.push(bn('374514321987325169863'))
      priceRatios.push(
        fp('0.016056468356548968'),
        fp('4.479236579234762935'),
        fp('7.341987325198354694')
      )
      fill.push(fp('0.176334768961354965'), fp('0.523449931646439834'))

      // total cases is 5 * 5 * 4 * 6 * 6 = 3600
    }

    const paramList = cartesianProduct(decimals, decimals, auctionSellAmts, priceRatios, fill)

    const numCases = paramList.length.toString()
    paramList.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(params)
      })
    })
  })

  describe('Regression Tests', () => {
    it('Passes Test: 12/03/2023 - Batch Auctions on Trade Settlement with one less token', async () => {
      // TX: 0xb5fc3d61d46e41b79bd333583448e6d4c186ca49206f8a0e7dde05f2700e0965
      // This set the broker to false since it was one token short.
      // This test is to make sure that the broker is not disabled in this case.

      const resetFork = async () => {
        await hre.network.provider.request({
          method: 'hardhat_reset',
          params: [
            {
              forking: {
                jsonRpcUrl: process.env.MAINNET_RPC_URL,
                blockNumber: 16813289,
              },
            },
          ],
        })
      }

      await resetFork()

      const backingManager = await ethers.getContractAt(
        'BackingManagerP1',
        '0xf014fef41ccb703975827c8569a3f0940cfd80a4'
      )

      await backingManager.settleTrade('0x39AA39c021dfbaE8faC545936693aC917d5E7563')
      expect(await broker.attach('0x90EB22A31b69C29C34162E0E9278cc0617aA2B50').disabled()).to.equal(
        true
      )

      await resetFork()

      const gnosisTradeImpl = await ethers.getContractAt(
        'GnosisTrade',
        '0xAc543Ee89A2238945f7D7Ad4d9Cf958721f9757c'
      )
      const gnosisTradeArtifact = await hre.artifacts.readArtifact('GnosisTrade')
      await setCode(gnosisTradeImpl.address, gnosisTradeArtifact.deployedBytecode)

      await backingManager.settleTrade('0x39AA39c021dfbaE8faC545936693aC917d5E7563')
      expect(await broker.attach('0x90EB22A31b69C29C34162E0E9278cc0617aA2B50').disabled()).to.equal(
        false
      )
    })
  })
})
