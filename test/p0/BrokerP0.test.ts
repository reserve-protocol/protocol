import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { TradeStatus } from '../../common/constants'
import { bn, toBNDecimals } from '../../common/numbers'
import {
  BackingManagerP0,
  BrokerP0,
  ERC20Mock,
  GnosisMock,
  GnosisTrade,
  MainP0,
  RevenueTradingP0,
  USDCMock,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { ITradeRequest } from './utils/trades'

const createFixtureLoader = waffle.createFixtureLoader

describe('BrokerP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let other: SignerWithAddress

  // Assets / Tokens
  let collateral0: Collateral
  let collateral1: Collateral
  let token0: ERC20Mock
  let token1: ERC20Mock

  // Trading
  let gnosis: GnosisMock
  let broker: BrokerP0

  // Config values
  let config: IConfig

  // Main contracts
  let main: MainP0
  let backingManager: BackingManagerP0
  let rsrTrader: RevenueTradingP0
  let rTokenTrader: RevenueTradingP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let basket: Collateral[]

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, other] = await ethers.getSigners()
    // Deploy fixture
    ;({ basket, config, main, backingManager, broker, gnosis, rsrTrader, rTokenTrader } =
      await loadFixture(defaultFixture))

    // Get assets
    ;[collateral0, collateral1, ,] = basket

    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
  })

  describe('Deployment', () => {
    it('Should setup Broker correctly', async () => {
      expect(await broker.gnosis()).to.equal(gnosis.address)
      expect(await broker.auctionLength()).to.equal(config.auctionLength)
      expect(await broker.disabled()).to.equal(false)
      expect(await broker.main()).to.equal(main.address)
    })
  })

  describe('Configuration/State', () => {
    it('Should allow to update auctionLength if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await broker.auctionLength()).to.equal(config.auctionLength)

      // If not owner cannot update
      await expect(broker.connect(other).setAuctionLength(newValue)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await broker.auctionLength()).to.equal(config.auctionLength)

      // Update with owner
      await expect(broker.connect(owner).setAuctionLength(newValue))
        .to.emit(broker, 'AuctionLengthSet')
        .withArgs(config.auctionLength, newValue)

      // Check value was updated
      expect(await broker.auctionLength()).to.equal(newValue)
    })

    it('Should allow to update disabled if Owner', async () => {
      // Check existing value
      expect(await broker.disabled()).to.equal(false)

      // If not owner cannot update
      await expect(broker.connect(other).setDisabled(true)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await broker.disabled()).to.equal(false)

      // Update with owner
      await expect(broker.connect(owner).setDisabled(true))
        .to.emit(broker, 'DisabledSet')
        .withArgs(false, true)

      // Check value was updated
      expect(await broker.disabled()).to.equal(true)

      // Update back to false
      await expect(broker.connect(owner).setDisabled(false))
        .to.emit(broker, 'DisabledSet')
        .withArgs(true, false)

      // Check value was updated
      expect(await broker.disabled()).to.equal(false)
    })
  })

  describe('Trade Management', () => {
    it('Should not allow to open trade if Disabled', async () => {
      // Disable Broker
      await expect(broker.connect(owner).setDisabled(true))
        .to.emit(broker, 'DisabledSet')
        .withArgs(false, true)

      // Attempt to open trade
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: bn('100e18'),
        minBuyAmount: bn('0'),
      }

      await expect(broker.openTrade(tradeRequest)).to.be.revertedWith('broker disabled')
    })

    it('Should not allow to open trade if not from trader', async () => {
      const amount: BigNumber = bn('100e18')

      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: bn('100e18'),
        minBuyAmount: bn('0'),
      }

      // Mint required tokens
      await token0.connect(owner).mint(backingManager.address, amount)
      await token0.connect(owner).mint(rsrTrader.address, amount)
      await token0.connect(owner).mint(rTokenTrader.address, amount)
      await token0.connect(owner).mint(addr1.address, amount)

      // Attempt to open trade from non-trader
      await token0.connect(addr1).approve(broker.address, amount)
      await expect(broker.connect(addr1).openTrade(tradeRequest)).to.be.revertedWith('only traders')

      // Open from traders - Should work
      // Backing Manager
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await token0.connect(bmSigner).approve(broker.address, amount)
        await expect(broker.connect(bmSigner).openTrade(tradeRequest)).to.not.be.reverted
      })

      // RSR Trader
      await whileImpersonating(rsrTrader.address, async (rsrSigner) => {
        await token0.connect(rsrSigner).approve(broker.address, amount)
        await expect(broker.connect(rsrSigner).openTrade(tradeRequest)).to.not.be.reverted
      })

      // RToken Trader
      await whileImpersonating(rTokenTrader.address, async (rtokSigner) => {
        await token0.connect(rtokSigner).approve(broker.address, amount)
        await expect(broker.connect(rtokSigner).openTrade(tradeRequest)).to.not.be.reverted
      })
    })

    it('Should not allow to report violation if not trade contract', async () => {
      // Check not disabled
      expect(await broker.disabled()).to.equal(false)

      // Should not allow to report violation from any address
      await expect(broker.connect(addr1).reportViolation()).to.be.revertedWith(
        'unrecognized trade contract'
      )

      // Same should happen with Backing Manager
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(broker.connect(bmSigner).reportViolation()).to.be.revertedWith(
          'unrecognized trade contract'
        )
      })

      // Check nothing changed
      expect(await broker.disabled()).to.equal(false)
    })
  })

  describe('Trades', () => {
    it('Should initialize trade correctly - only once', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Check state
      expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)

      // Initialize trade - simulate from backingManager
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: amount,
        minBuyAmount: bn('0'),
      }

      // Fund trade and initialize
      await token0.connect(owner).mint(trade.address, amount)
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.not.be.reverted

      // Check trade values
      expect(await trade.gnosis()).to.equal(gnosis.address)
      expect(await trade.auctionId()).to.equal(0)
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.broker()).to.equal(broker.address)
      expect(await trade.origin()).to.equal(backingManager.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(token1.address)
      expect(await trade.sellAmount()).to.equal(amount)
      expect(await trade.endTime()).to.equal(
        (await getLatestBlockTimestamp()) + Number(config.auctionLength)
      )
      expect(await trade.worstCasePrice()).to.equal(bn('0'))
      expect(await trade.canSettle()).to.equal(false)

      // Attempt to initialize again
      await expect(
        trade.init(
          await trade.broker(),
          await trade.origin(),
          await trade.gnosis(),
          await broker.auctionLength(),
          tradeRequest
        )
      ).to.be.revertedWith('trade already started')
    })

    it('Should not allow to initialize an unfunded trade', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Check state
      expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)

      // Initialize trade - simulate from backingManager
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: amount,
        minBuyAmount: bn('0'),
      }

      // Attempt to initialize without funding
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.be.revertedWith('unfunded trade')
    })

    it('Should be able to settle a trade - performing validations', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Check state - cannot be settled
      expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)
      expect(await trade.canSettle()).to.equal(false)

      // Initialize trade - simulate from backingManager
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: amount,
        minBuyAmount: bn('0'),
      }

      // Attempt to settle - will fail as origin is not set
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('only origin can settle')
      })

      // Fund trade and initialize
      await token0.connect(owner).mint(trade.address, amount)
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.not.be.reverted

      // Check trade is initialized but still cannot be settled
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.equal(false)

      // Attempt to settle from origin - Cannot settle yet
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('cannot settle yet')
      })

      // Advance time till trade can be settled
      await advanceTime(config.auctionLength.add(100).toString())

      // Check status - can be settled now
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.equal(true)

      // Attempt to settle from other address (not origin)
      await expect(trade.connect(addr1).settle()).to.be.revertedWith('only origin can settle')

      // Settle trade
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.not.be.reverted
      })

      // Check status
      expect(await trade.status()).to.equal(TradeStatus.CLOSED)
      expect(await trade.canSettle()).to.equal(false)
    })

    it('Should be able to settle a trade - handles arbitrary funds being sent to trade', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Check state - cannot be settled
      expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)
      expect(await trade.canSettle()).to.equal(false)

      // Initialize trade - simulate from backingManager
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: amount,
        minBuyAmount: bn('0'),
      }

      // Fund trade and initialize
      await token0.connect(owner).mint(trade.address, amount)
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.not.be.reverted

      // Check trade is initialized but still cannot be settled
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.equal(false)

      // Advance time till trade can be settled
      await advanceTime(config.auctionLength.add(100).toString())

      // Check status - can be settled now
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.equal(true)

      // Perform mock bid - do not cover full amount
      const bidAmount: BigNumber = amount.sub(bn('1e18'))
      const minBuyAmt: BigNumber = toBNDecimals(bidAmount, 6)
      await token1.connect(owner).mint(addr1.address, minBuyAmt)
      await token1.connect(addr1).approve(gnosis.address, minBuyAmt)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: bidAmount,
        buyAmount: minBuyAmt,
      })

      // Settle auction directly in Gnosis
      await gnosis.settleAuction(0)

      // Send tokens to the trade to try to disable it (Potential attack)
      const additionalFundsSell: BigNumber = amount
      const additionalFundsBuy: BigNumber = toBNDecimals(amount.div(2), 6)

      await token0.connect(owner).mint(trade.address, amount)
      await token1.connect(owner).mint(trade.address, toBNDecimals(amount.div(2), 6))

      // Settle trade
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.not.be.reverted
      })

      // Check status
      expect(await trade.status()).to.equal(TradeStatus.CLOSED)
      expect(await trade.canSettle()).to.equal(false)

      // Additional funds transfered to origin
      expect(await token0.balanceOf(backingManager.address)).to.equal(
        bn('1e18').add(additionalFundsSell)
      )
      expect(await token1.balanceOf(backingManager.address)).to.equal(
        minBuyAmt.add(additionalFundsBuy)
      )

      // Funds sent to bidder
      expect(await token0.balanceOf(addr1.address)).to.equal(bidAmount)
    })

    it('Should allow anyone to transfer to origin after a trade is complete', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Initialize trade - simulate from backingManager
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: amount,
        minBuyAmount: bn('0'),
      }

      // Fund trade and initialize
      await token0.connect(owner).mint(trade.address, amount)
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.not.be.reverted

      // Check balances on Trade and Origin
      expect(await token0.balanceOf(trade.address)).to.equal(0)
      expect(await token0.balanceOf(backingManager.address)).to.equal(0)

      // Attempt to transfer the new funds to origin while the Trade is still open
      await expect(trade.transferToOriginAfterTradeComplete(token0.address)).to.be.revertedWith(
        'only after trade is closed'
      )

      // Advance time till trade can be settled
      await advanceTime(config.auctionLength.add(100).toString())

      // Settle trade
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.not.be.reverted
      })

      // Check status
      expect(await trade.status()).to.equal(TradeStatus.CLOSED)

      // Check balances on Trade and Origin - Funds sent back to origin (no bids)
      expect(await token0.balanceOf(trade.address)).to.equal(0)
      expect(await token0.balanceOf(backingManager.address)).to.equal(amount)

      // Send arbitrary funds to Trade
      const newFunds: BigNumber = amount.div(2)
      await token0.connect(owner).mint(trade.address, newFunds)

      // Check balances again
      expect(await token0.balanceOf(trade.address)).to.equal(newFunds)
      expect(await token0.balanceOf(backingManager.address)).to.equal(amount)

      // Transfer to origin
      await expect(trade.transferToOriginAfterTradeComplete(token0.address))
        .to.emit(token0, 'Transfer')
        .withArgs(trade.address, backingManager.address, newFunds)

      // Check balances again - funds sent to origin
      expect(await token0.balanceOf(trade.address)).to.equal(0)
      expect(await token0.balanceOf(backingManager.address)).to.equal(amount.add(newFunds))
    })
  })
})
