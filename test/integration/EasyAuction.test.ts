import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral, defaultFixture, IMPLEMENTATION } from '../fixtures'
import { bn, fp } from '../../common/numbers'
import { expectEvents } from '../../common/events'
import { IConfig, networkConfig } from '../../common/configuration'
import { CollateralStatus, QUEUE_START } from '../../common/constants'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { expectTrade, getAuctionId, getTrade } from '../utils/trades'
import { setOraclePrice } from '../utils/oracles'
import { getChainId } from '../../common/blockchain-utils'
import { whileImpersonating } from '../utils/impersonation'
import {
  EasyAuction,
  ERC20Mock,
  FacadeTest,
  FiatCollateral,
  IAssetRegistry,
  IBasketHandler,
  RTokenAsset,
  TestIBackingManager,
  TestIBroker,
  TestIRToken,
  TestIStRSR,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

let owner: SignerWithAddress
let addr1: SignerWithAddress
let addr2: SignerWithAddress

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`Gnosis EasyAuction Mainnet Forking - P${IMPLEMENTATION}`, function () {
  let config: IConfig

  let rsr: ERC20Mock
  let stRSR: TestIStRSR
  let rToken: TestIRToken
  let broker: TestIBroker
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry

  let easyAuction: EasyAuction

  let basket: Collateral[]
  let collateral: Collateral[]
  let collateral0: FiatCollateral
  let token0: ERC20Mock
  let token1: ERC20Mock
  let rTokenAsset: RTokenAsset

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

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
      issueAmount = bn('10000e18')
      sellAmt = issueAmount.mul(100).div(99).add(1)
      buyAmt = issueAmount.add(1)

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
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))

      // Take backing
      await token0.connect(owner).burn(backingManager.address, issueAmount)

      // Prepare addr1/addr2 for trading
      expect(await token0.balanceOf(addr1.address)).to.equal(0)
      await token0.connect(owner).mint(addr1.address, issueAmount.mul(1e9))
      await token0.connect(owner).mint(addr2.address, issueAmount.mul(1e9))

      // Create auction
      await expect(backingManager.manageTokens([]))
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(anyValue, rsr.address, token0.address, sellAmt, buyAmt)

      const auctionTimestamp: number = await getLatestBlockTimestamp()
      auctionId = await getAuctionId(backingManager, rsr.address)

      // Check auction registered
      // RSR -> Token0 Auction
      await expectTrade(backingManager, {
        sell: rsr.address,
        buy: token0.address,
        endTime: auctionTimestamp + Number(config.auctionLength),
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
      await expect(backingManager.manageTokens([])).to.not.emit(backingManager, 'TradeStarted')

      // Auction should not be able to be settled
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted
    })

    afterEach(async () => {
      // Should not trigger a de-listing of the auction platform
      expect(await broker.disabled()).to.equal(false)

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
      await advanceTime(config.auctionLength.add(100).toString())

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
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt.div(2), bidAmt.sub(1)],
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
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt.div(2), bidAmt.sub(1)],
          emitted: true,
        },
      ])

      // Check state - Should be undercapitalized
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
      await advanceTime(config.auctionLength.add(100).toString())

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
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Should be undercapitalized
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
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction -- should trade at lower worst-case price
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, rsr.address, token0.address, sellAmt.mul(2), bidAmt],
          emitted: true,
        },
      ])

      // Check state - Should be undercapitalized
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
      await advanceTime(config.auctionLength.add(100).toString())

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
      await advanceTime(config.auctionLength.add(100).toString())
      await backingManager.settleTrade(rsr.address)

      // $0.007 RSR at $4k ETH
      const rsrPrice = bn('0.007e8')
      await setOraclePrice(await assetRegistry.toAsset(rsr.address), rsrPrice)
      // sellAmt = BigNumber.from(config.rTokenMaxTradeVolume)

      // Fix backing in a single auction, since it all fits inside the $1M maxTradeVolume
      const rsrPriceFix = rsrPrice.mul(bn('1e10'))
      buyAmt = issueAmount.add(1)
      sellAmt = issueAmount.mul(fp('1')).div(rsrPriceFix).mul(100).div(99).add(2)

      // Start next auction
      await expectEvents(backingManager.manageTokens([]), [
        {
          contract: backingManager,
          name: 'TradeStarted',
          args: [anyValue, rsr.address, token0.address, sellAmt, buyAmt],
          emitted: true,
        },
      ])

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
      await advanceTime(config.auctionLength.add(100).toString())

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
      await advanceTime(config.auctionLength.add(100).toString())

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

  context('token0 -> token1', function () {
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

      // Issue
      await token0.connect(owner).mint(addr1.address, issueAmount)
      await token1.connect(owner).mint(addr1.address, issueAmount)
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
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
    })

    it('should be able to scoop entire auction cheaply when minBuyAmount = 0', async () => {
      // Default collateral0
      await setOraclePrice(collateral0.address, bn('0.5e8')) // depeg
      await collateral0.refresh()
      await advanceTime((await collateral0.delayUntilDefault()).toString())
      await basketHandler.refreshBasket()

      // Should launch auction for token1
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')

      const auctionTimestamp: number = await getLatestBlockTimestamp()
      const auctionId = await getAuctionId(backingManager, token0.address)

      // Check auction opened even at minBuyAmount = 0
      await expectTrade(backingManager, {
        sell: token0.address,
        buy: token1.address,
        endTime: auctionTimestamp + Number(config.auctionLength),
        externalId: auctionId,
      })
      const trade = await getTrade(backingManager, token0.address)
      expect(await trade.status()).to.equal(1) // TradeStatus.OPEN

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check Gnosis
      expect(await token0.balanceOf(easyAuction.address)).to.equal(issueAmount)
      await expect(backingManager.manageTokens([])).to.not.emit(backingManager, 'TradeStarted')

      // Auction should not be able to be settled
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted

      await token1.connect(addr1).approve(easyAuction.address, issueAmount)

      // Bid with a too-small order and fail.
      const lowBidAmt = 2
      await expect(
        easyAuction
          .connect(addr1)
          .placeSellOrders(
            auctionId,
            [issueAmount],
            [lowBidAmt],
            [QUEUE_START],
            ethers.constants.HashZero
          )
      ).to.be.revertedWith('order too small')

      // Bid with a nontheless pretty small order, and succeed.
      const bidAmt = await trade.DEFAULT_MIN_BID()
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
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(token0.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, token0.address, token1.address, issueAmount, bidAmt],
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

      // Default collateral0
      await setOraclePrice(collateral0.address, bn('0.5e8')) // depeg
      await collateral0.refresh()
      await advanceTime((await collateral0.delayUntilDefault()).toString())
      await basketHandler.refreshBasket()

      // Should launch auction for token1
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')

      const auctionTimestamp: number = await getLatestBlockTimestamp()
      const auctionId = await getAuctionId(backingManager, token0.address)

      // Check auction opened even at minBuyAmount = 0
      await expectTrade(backingManager, {
        sell: token0.address,
        buy: token1.address,
        endTime: auctionTimestamp + Number(config.auctionLength),
        externalId: auctionId,
      })
      const trade = await getTrade(backingManager, token0.address)
      expect(await trade.status()).to.equal(1) // TradeStatus.OPEN

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check Gnosis
      expect(await token0.balanceOf(easyAuction.address)).to.be.closeTo(issueAmount, 1)
      await expect(backingManager.manageTokens([])).to.not.emit(backingManager, 'TradeStarted')

      // Auction should not be able to be settled
      await expect(easyAuction.settleAuction(auctionId)).to.be.reverted

      await token1.connect(addr1).approve(easyAuction.address, issueAmount)

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
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction
      await expectEvents(backingManager.settleTrade(token0.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [anyValue, token0.address, token1.address, issueAmount.sub(1), actualSellAmount], // Account for rounding
          emitted: true,
        },
      ])

      expect(await token0.balanceOf(easyAuctionOwner)).to.be.closeTo(feeAmt, 1) // account for rounding
    })
  })
})
