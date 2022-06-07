import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { Collateral, IConfig, defaultFixture, IMPLEMENTATION } from '../fixtures'
import { bn, fp } from '../../common/numbers'
import { expectEvents } from '../../common/events'
import { CollateralStatus, QUEUE_START } from '../../common/constants'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { expectTrade, getAuctionId } from '../utils/trades'
import {
  AaveOracleMock,
  EasyAuction,
  ERC20Mock,
  TestIBackingManager,
  IBasketHandler,
  TestIStRSR,
  Facade,
  TestIRToken,
  TestIBroker,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

let owner: SignerWithAddress
let addr1: SignerWithAddress
let addr2: SignerWithAddress

describe(`Gnosis EasyAuction Mainnet Forking - P${IMPLEMENTATION}`, function () {
  if (!process.env.FORK) {
    return
  }

  let config: IConfig

  let rsr: ERC20Mock
  let stRSR: TestIStRSR
  let rToken: TestIRToken
  let broker: TestIBroker
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let facade: Facade
  let aaveOracleInternal: AaveOracleMock

  let easyAuction: EasyAuction

  let basket: Collateral[]
  let collateral: Collateral[]
  let token0: ERC20Mock

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
      aaveOracleInternal,
      basket,
      config,
      rToken,
      erc20s,
      stRSR,
      broker,
      rsr,
      collateral,
      easyAuction,
      facade,
      backingManager,
      basketHandler,
    } = await loadFixture(defaultFixture))

    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
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
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rToken.price()).to.equal(fp('1'))

      // Take backing
      await token0.connect(owner).burn(backingManager.address, issueAmount)

      // Prepare addr1/addr2 for trading
      expect(await token0.balanceOf(addr1.address)).to.equal(0)
      await token0.connect(owner).mint(addr1.address, issueAmount.mul(1e9))
      await token0.connect(owner).mint(addr2.address, issueAmount.mul(1e9))

      // Create auction
      await expect(backingManager.manageTokens([]))
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(rsr.address, token0.address, sellAmt, buyAmt)

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
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check Gnosis
      expect(await rsr.balanceOf(easyAuction.address)).to.equal(sellAmt)
      await expect(backingManager.manageTokens([])).to.not.emit(backingManager, 'TradeStarted')
    })

    // Should not trigger a de-listing of the auction platform
    afterEach(async () => {
      expect(await broker.disabled()).to.equal(false)
    })

    it('no volume -- no bids', async () => {
      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction, should restart
      await expectEvents(facade.runAuctionsForAllTraders(rToken.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [rsr.address, token0.address, 0, 0],
          emitted: true,
        },
        {
          contract: backingManager,
          name: 'TradeStarted',
          args: [rsr.address, token0.address, sellAmt, buyAmt],
          emitted: true,
        },
      ])
    })

    it('no volume -- bids worse than worst-case price', async () => {
      const bidAmt = buyAmt.div(2).sub(1)
      await token0.connect(addr1).approve(easyAuction.address, bidAmt)
      await expect(
        easyAuction
          .connect(addr1)
          .placeSellOrders(
            auctionId,
            [sellAmt.div(2)],
            [bidAmt],
            [QUEUE_START],
            ethers.constants.HashZero
          )
      ).to.be.reverted

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction, should restart
      await expectEvents(facade.runAuctionsForAllTraders(rToken.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [rsr.address, token0.address, 0, 0],
          emitted: true,
        },
        {
          contract: backingManager,
          name: 'TradeStarted',
          args: [rsr.address, token0.address, sellAmt, buyAmt],
          emitted: true,
        },
      ])
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
          args: [rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
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
          args: [rsr.address, token0.address, sellAmt.div(2), bidAmt.sub(1)],
          emitted: true,
        },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(bidAmt.sub(1))
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
          args: [rsr.address, token0.address, sellAmt.div(2), bidAmt.sub(1)],
          emitted: true,
        },
      ])

      // Check state - Should be undercapitalized
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt.sub(1))
      expect(await token0.balanceOf(easyAuction.address)).to.equal(1) // remainder
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(sellAmt.div(2))
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
          args: [rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Should be undercapitalized
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
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
      await aaveOracleInternal.setPrice(rsr.address, bn('1.75e12'))
      sellAmt = issueAmount.mul(bn('2.5e14')).mul(100).div(99).div(bn('1.75e12')).add(2)

      // Start next auction
      await expectEvents(backingManager.manageTokens([]), [
        {
          contract: backingManager,
          name: 'TradeStarted',
          args: [rsr.address, token0.address, sellAmt, buyAmt],
          emitted: true,
        },
      ])
      auctionId = auctionId.add(1)

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
          args: [rsr.address, token0.address, sellAmt, bidAmt],
          emitted: true,
        },
      ])

      // Check state - Should be undercapitalized
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await token0.balanceOf(backingManager.address)).to.equal(bidAmt)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })
  })
})
