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
  USDCMock,
  Facade,
  TestIRToken,
  StaticATokenMock,
  CTokenMock,
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
  let initialBal: BigNumber

  let config: IConfig

  let rToken: TestIRToken
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let facade: Facade

  let gnosis: EasyAuction

  let basket: Collateral[]
  let collateral: Collateral[]
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock

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
      collateral,
      gnosis,
      facade,
      backingManager,
      basketHandler,
    } = await loadFixture(defaultFixture))

    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
    token1 = <USDCMock>erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)
  })

  context('basic usage', function () {
    let issueAmount: BigNumber

    beforeEach(async function () {
      issueAmount = bn('100e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Setup new basket with single token
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('Should recapitalize correctly when switching basket - Full amount covered', async () => {
      // Setup prime basket
      await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

      // Check initial state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
      expect(await token1.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check price in USD of the current RToken
      expect(await rToken.price()).to.equal(fp('1'))

      // Switch Basket
      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs([token1.address], [fp('1')], false)

      // Check state remains SOUND
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
      expect(await token1.balanceOf(backingManager.address)).to.equal(0)

      // Check price in USD of the current RToken
      expect(await rToken.price()).to.equal(fp('1'))

      // Trigger recapitalization
      const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
      const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

      await expect(facade.runAuctionsForAllTraders())
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

      const auctionTimestamp: number = await getLatestBlockTimestamp()

      const auctionId = await getAuctionId(backingManager, token0.address)

      // Check auction registered
      // Token0 -> Token1 Auction
      await expectTrade(backingManager, {
        sell: token0.address,
        buy: token1.address,
        endTime: auctionTimestamp + Number(config.auctionLength),
        externalId: auctionId,
      })

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(false)
      // Asset value is zero, everything was moved to the Market
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await token1.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check price in USD of the current RToken
      expect(await rToken.price()).to.equal(fp('1'))

      // Check Gnosis
      expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

      // Another call should not create any new auctions if still ongoing
      await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

      // Perform Real Bids for the new Token (addr1 has balance)
      // Get fair price - all tokens
      await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
      await gnosis
        .connect(addr1)
        .placeSellOrders(
          auctionId,
          [sellAmt],
          [toBNDecimals(sellAmt, 6)],
          [QUEUE_START],
          ethers.constants.HashZero
        )

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction, should  not start any new auctions
      await expectEvents(facade.runAuctionsForAllTraders(), [
        {
          contract: backingManager,
          name: 'TradeSettled',
          args: [token0.address, token1.address, sellAmt, toBNDecimals(sellAmt, 6)],
          emitted: true,
        },
        { contract: backingManager, name: 'TradeStarted', emitted: false },
      ])

      // Check state - Order restablished
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)
      expect(await token1.balanceOf(backingManager.address)).to.equal(toBNDecimals(issueAmount, 6))
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check price in USD of the current RToken
      expect(await rToken.price()).to.equal(fp('1'))
    })
  })
})
