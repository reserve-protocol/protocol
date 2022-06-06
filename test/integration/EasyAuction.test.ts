import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { MAINNET_BLOCK_NUMBER } from './mainnet'
import { Collateral, IConfig, defaultFixture, IMPLEMENTATION } from '../fixtures'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { expectEvents } from '../../common/events'
import { CollateralStatus, QUEUE_START } from '../../common/constants'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { expectTrade, getAuctionId } from '../utils/trades'
import {
  EasyAuction,
  ERC20Mock,
  TestIBackingManager,
  IBasketHandler,
  TestIStRSR,
  Facade,
  TestIRToken,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

let owner: SignerWithAddress
let addr1: SignerWithAddress

// Setup test environment
const setup = async () => {
  ;[owner, addr1] = await ethers.getSigners()

  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: MAINNET_BLOCK_NUMBER,
        },
      },
    ],
  })
}

describe(`Gnosis EasyAuction Mainnet Forking - P${IMPLEMENTATION}`, function () {
  if (!process.env.FORK) {
    return
  }

  let config: IConfig

  let rsr: ERC20Mock
  let stRSR: TestIStRSR
  let rToken: TestIRToken
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let facade: Facade

  let easyAuction: EasyAuction

  let basket: Collateral[]
  let collateral: Collateral[]
  let token0: ERC20Mock

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    await setup()
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    let erc20s: ERC20Mock[]
    ;({
      basket,
      config,
      rToken,
      erc20s,
      stRSR,
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
    let amount: BigNumber
    let minBuyAmt: BigNumber
    let auctionId: BigNumber

    // Set up an auction of 10_000e18 RSR for token0
    beforeEach(async function () {
      amount = bn('10000e18')
      minBuyAmt = amount.mul(99).div(100)

      // Set prime basket
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Issue
      await token0.connect(owner).mint(addr1.address, amount)
      await token0.connect(addr1).approve(rToken.address, amount)
      await rToken.connect(addr1).issue(amount)

      // Seed stake
      await rsr.connect(owner).mint(addr1.address, amount)
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check initial state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(amount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)
      expect(await rToken.price()).to.equal(fp('1'))

      // Take backing
      await token0.connect(owner).burn(backingManager.address, amount)

      // Prepare addr1 for trading
      expect(await token0.balanceOf(addr1.address)).to.equal(0)
      await token0.connect(owner).mint(addr1.address, amount) // excess
      expect(await token0.balanceOf(addr1.address)).to.equal(amount)

      // Create auction
      await expect(backingManager.manageTokens([]))
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(rsr.address, token0.address, amount, minBuyAmt)

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
      expect(await rToken.totalSupply()).to.equal(amount)

      // Check Gnosis
      expect(await rsr.balanceOf(easyAuction.address)).to.equal(amount)
      await expect(backingManager.manageTokens([])).to.not.emit(backingManager, 'TradeStarted')
    })

    it('Should recapitalize -- bid at asking price', async () => {
      // Perform Real Bids for the new Token (addr1 has balance)
      // Get fair price - all tokens
      await token0.connect(addr1).approve(easyAuction.address, amount)
      await easyAuction
        .connect(addr1)
        .placeSellOrders(auctionId, [amount], [amount], [QUEUE_START], ethers.constants.HashZero)

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction, should not start any new auctions
      await expectEvents(backingManager.settleTrade(rsr.address), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [rsr.address, token0.address, amount, amount],
          emitted: true,
        },
        { contract: backingManager, name: 'TradeStarted', emitted: false },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(amount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(amount)
      expect(await token0.balanceOf(easyAuction.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
    })

    // it('Should recapitalize -- bid at worst-case price', async () => {
    //   const buyAmt = amount.add(1)
    //   // Perform Real Bids for the new Token (addr1 has balance)
    //   // Get fair price - all tokens
    //   await token0.connect(addr1).approve(easyAuction.address, buyAmt)
    //   await easyAuction
    //     .connect(addr1)
    //     .placeSellOrders(auctionId, [amount], [buyAmt], [QUEUE_START], ethers.constants.HashZero)

    //   // Advance time till auction ended
    //   await advanceTime(config.auctionLength.add(100).toString())

    //   // End current auction, should not start any new auctions
    //   await expectEvents(facade.runAuctionsForAllTraders(rToken.address), [
    //     {
    //       contract: backingManager,
    //       name: 'TradeSettled',
    //       args: [token0.address, token0.address, amount, buyAmt],
    //       emitted: true,
    //     },
    //     { contract: backingManager, name: 'TradeStarted', emitted: false },
    //   ])

    //   // Check state - Order restablished
    //   expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    //   expect(await basketHandler.fullyCapitalized()).to.equal(true)
    //   expect(await token0.balanceOf(backingManager.address)).to.equal(0)
    //   expect(await token0.balanceOf(backingManager.address)).to.equal(buyAmt)
    //   expect(await rToken.totalSupply()).to.equal(amount)
    // })
  })
})
