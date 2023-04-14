import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { IConfig, MAX_AUCTION_LENGTH } from '../common/configuration'
import { MAX_UINT96, TradeStatus, ZERO_ADDRESS } from '../common/constants'
import { bn, toBNDecimals } from '../common/numbers'
import {
  ERC20Mock,
  GnosisMock,
  GnosisMockReentrant,
  GnosisTrade,
  TestIBackingManager,
  TestIBroker,
  TestIMain,
  TestIRevenueTrader,
  USDCMock,
  ZeroDecimalMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import {
  Collateral,
  DefaultFixture,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
} from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'
import { advanceTime, getLatestBlockTimestamp } from './utils/time'
import { ITradeRequest } from './utils/trades'
import { useEnv } from '#/utils/env'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe(`BrokerP${IMPLEMENTATION} contract #fast`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let mock: SignerWithAddress
  let other: SignerWithAddress

  // Assets / Tokens
  let collateral0: Collateral
  let collateral1: Collateral
  let collateralZ: Collateral
  let token0: ERC20Mock
  let token1: ERC20Mock
  let tokenZ: ERC20Mock

  // Trading
  let gnosis: GnosisMock
  let broker: TestIBroker

  // Config values
  let config: IConfig

  // Main contracts
  let main: TestIMain
  let backingManager: TestIBackingManager
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  let basket: Collateral[]
  let collateral: Collateral[]

  beforeEach(async () => {
    ;[owner, addr1, mock, other] = await ethers.getSigners()
    // Deploy fixture
    ;({
      basket,
      config,
      main,
      backingManager,
      broker,
      gnosis,
      rsrTrader,
      rTokenTrader,
      collateral,
    } = <DefaultFixture>await loadFixture(defaultFixture))

    // Get assets
    ;[collateral0, collateral1, ,] = basket
    collateralZ = collateral[collateral.length - 1]

    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    tokenZ = <ZeroDecimalMock>(
      await ethers.getContractAt('ZeroDecimalMock', await collateralZ.erc20())
    )
  })

  describe('Deployment', () => {
    it('Should setup Broker correctly', async () => {
      expect(await broker.gnosis()).to.equal(gnosis.address)
      expect(await broker.auctionLength()).to.equal(config.auctionLength)
      expect(await broker.disabled()).to.equal(false)
      expect(await broker.main()).to.equal(main.address)
    })

    it('Should perform validations on init', async () => {
      // Create a Broker
      const BrokerFactory: ContractFactory = await ethers.getContractFactory(
        `BrokerP${IMPLEMENTATION}`
      )

      let newBroker: TestIBroker = <TestIBroker>await BrokerFactory.deploy()

      if (IMPLEMENTATION == Implementation.P1) {
        newBroker = <TestIBroker>await upgrades.deployProxy(BrokerFactory, [], {
          kind: 'uups',
        })
      }

      await expect(
        newBroker.init(main.address, ZERO_ADDRESS, ZERO_ADDRESS, bn('100'))
      ).to.be.revertedWith('invalid Gnosis address')
      await expect(
        newBroker.init(main.address, gnosis.address, ZERO_ADDRESS, bn('100'))
      ).to.be.revertedWith('invalid Trade Implementation address')
    })
  })

  describe('Configuration/State', () => {
    it('Should allow to update Gnosis if Owner and perform validations', async () => {
      // Check existing value
      expect(await broker.gnosis()).to.equal(gnosis.address)

      // If not owner cannot update
      await expect(broker.connect(other).setGnosis(mock.address)).to.be.revertedWith(
        'governance only'
      )

      // Check value did not change
      expect(await broker.gnosis()).to.equal(gnosis.address)

      // Attempt to update with Owner but zero address - not allowed
      await expect(broker.connect(owner).setGnosis(ZERO_ADDRESS)).to.be.revertedWith(
        'invalid Gnosis address'
      )

      // Update with owner
      await expect(broker.connect(owner).setGnosis(mock.address))
        .to.emit(broker, 'GnosisSet')
        .withArgs(gnosis.address, mock.address)

      // Check value was updated
      expect(await broker.gnosis()).to.equal(mock.address)
    })

    it('Should allow to update Trade Implementation if Owner and perform validations', async () => {
      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const tradeImpl: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Update to a trade implementation to use as baseline for tests
      await expect(broker.connect(owner).setTradeImplementation(tradeImpl.address))
        .to.emit(broker, 'TradeImplementationSet')
        .withArgs(anyValue, tradeImpl.address)

      // Check existing value
      expect(await broker.tradeImplementation()).to.equal(tradeImpl.address)

      // If not owner cannot update
      await expect(broker.connect(other).setTradeImplementation(mock.address)).to.be.revertedWith(
        'governance only'
      )

      // Check value did not change
      expect(await broker.tradeImplementation()).to.equal(tradeImpl.address)

      // Attempt to update with Owner but zero address - not allowed
      await expect(broker.connect(owner).setTradeImplementation(ZERO_ADDRESS)).to.be.revertedWith(
        'invalid Trade Implementation address'
      )

      // Update with owner
      await expect(broker.connect(owner).setTradeImplementation(mock.address))
        .to.emit(broker, 'TradeImplementationSet')
        .withArgs(tradeImpl.address, mock.address)

      // Check value was updated
      expect(await broker.tradeImplementation()).to.equal(mock.address)
    })

    it('Should allow to update auctionLength if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await broker.auctionLength()).to.equal(config.auctionLength)

      // If not owner cannot update
      await expect(broker.connect(other).setAuctionLength(newValue)).to.be.revertedWith(
        'governance only'
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

    it('Should perform validations on auctionLength', async () => {
      let invalidValue: BigNumber = bn(0)

      // Attempt to update
      await expect(broker.connect(owner).setAuctionLength(invalidValue)).to.be.revertedWith(
        'invalid auctionLength'
      )

      invalidValue = bn(MAX_AUCTION_LENGTH + 1)

      // Attempt to update
      await expect(broker.connect(owner).setAuctionLength(invalidValue)).to.be.revertedWith(
        'invalid auctionLength'
      )
    })

    it('Should allow to update disabled if Owner', async () => {
      // Check existing value
      expect(await broker.disabled()).to.equal(false)

      // If not owner cannot update
      await expect(broker.connect(other).setDisabled(true)).to.be.revertedWith('governance only')

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

      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(broker.connect(bmSigner).openTrade(tradeRequest)).to.be.revertedWith(
          'broker disabled'
        )
      })
    })

    it('Should not allow to open trade if paused', async () => {
      await main.connect(owner).pause()

      // Attempt to open trade
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: bn('100e18'),
        minBuyAmount: bn('0'),
      }

      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(broker.connect(bmSigner).openTrade(tradeRequest)).to.be.revertedWith(
          'paused or frozen'
        )
      })
    })

    it('Should not allow to open trade if frozen', async () => {
      await main.connect(owner).pause()

      // Attempt to open trade
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: bn('100e18'),
        minBuyAmount: bn('0'),
      }

      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(broker.connect(bmSigner).openTrade(tradeRequest)).to.be.revertedWith(
          'paused or frozen'
        )
      })
    })

    it('Should not allow to open trade if a trader', async () => {
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

    it('Should not allow to report violation if paused or frozen', async () => {
      // Check not disabled
      expect(await broker.disabled()).to.equal(false)

      await main.connect(owner).pause()

      await expect(broker.connect(addr1).reportViolation()).to.be.revertedWith('paused or frozen')

      await main.connect(owner).unpause()

      await main.connect(owner).freezeShort()

      await expect(broker.connect(addr1).reportViolation()).to.be.revertedWith('paused or frozen')

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
      expect(await trade.initBal()).to.equal(amount)
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
      ).to.be.revertedWith('Invalid trade state')
    })

    it('Should initialize trade with minimum buy amount of at least 1', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Check state
      expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)

      // Initialize trade - simulate from backingManager
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateralZ.address,
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
      expect(await trade.buy()).to.equal(tokenZ.address)
      expect(await trade.initBal()).to.equal(amount)
      expect(await trade.endTime()).to.equal(
        (await getLatestBlockTimestamp()) + Number(config.auctionLength)
      )
      expect(await trade.worstCasePrice()).to.equal(bn('0'))
      expect(await trade.canSettle()).to.equal(false)
    })

    it('Should protect against reentrancy when initializing trade', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Reetrant Gnosis
      const GnosisReentrantFactory: ContractFactory = await ethers.getContractFactory(
        'GnosisMockReentrant'
      )
      const reentrantGnosis: GnosisMockReentrant = <GnosisMockReentrant>(
        await GnosisReentrantFactory.deploy()
      )
      await reentrantGnosis.setReenterOnInit(true)

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

      // Fund trade and initialize with reentrant Gnosis
      await token0.connect(owner).mint(trade.address, amount)
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          reentrantGnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.be.revertedWith('Invalid trade state')
    })

    it('Should perform balance and amounts validations on init', async () => {
      const amount: BigNumber = bn('100e18')
      const invalidAmount: BigNumber = MAX_UINT96.add(1)

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Check state
      expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)

      // Initialize trade - Sell Amount too large
      // Fund trade
      await token0.connect(owner).mint(trade.address, invalidAmount)
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: invalidAmount,
        minBuyAmount: bn('0'),
      }

      // Attempt to initialize
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.be.revertedWith('sellAmount too large')

      // Initialize trade - MinBuyAmount  too large
      tradeRequest.sellAmount = amount
      tradeRequest.minBuyAmount = invalidAmount

      // Attempt to initialize
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.be.revertedWith('minBuyAmount too large')

      // Restore value
      tradeRequest.minBuyAmount = bn('0')

      // Fund trade with large balance
      await token0.connect(owner).mint(trade.address, invalidAmount)

      // Attempt to initialize
      await expect(
        trade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.be.revertedWith('initBal too large')
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

      // Attempt to settle (will fail)
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('Invalid trade state')
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

    it('Should protect against reentrancy when settling trade', async () => {
      const amount: BigNumber = bn('100e18')

      // Create a Reetrant Gnosis
      const GnosisReentrantFactory: ContractFactory = await ethers.getContractFactory(
        'GnosisMockReentrant'
      )
      const reentrantGnosis: GnosisMockReentrant = <GnosisMockReentrant>(
        await GnosisReentrantFactory.deploy()
      )
      await reentrantGnosis.setReenterOnInit(false)
      await reentrantGnosis.setReenterOnSettle(true)

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
          reentrantGnosis.address,
          config.auctionLength,
          tradeRequest
        )
      ).to.not.be.reverted

      // Advance time till trade can be settled
      await advanceTime(config.auctionLength.add(100).toString())

      // Attempt Settle trade
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('Invalid trade state')
      })
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

  describeGas('Gas Reporting', () => {
    let amount: BigNumber
    let tradeRequest: ITradeRequest
    let TradeFactory: ContractFactory
    let newTrade: GnosisTrade

    beforeEach(async () => {
      amount = bn('100e18')

      tradeRequest = {
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

      // Create a new trade
      TradeFactory = await ethers.getContractFactory('GnosisTrade')
      newTrade = <GnosisTrade>await TradeFactory.deploy()
    })

    it('Open Trade ', async () => {
      // Open from traders
      // Backing Manager
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await token0.connect(bmSigner).approve(broker.address, amount)
        await snapshotGasCost(broker.connect(bmSigner).openTrade(tradeRequest))
      })

      // RSR Trader
      await whileImpersonating(rsrTrader.address, async (rsrSigner) => {
        await token0.connect(rsrSigner).approve(broker.address, amount)
        await snapshotGasCost(broker.connect(rsrSigner).openTrade(tradeRequest))
      })

      // RToken Trader
      await whileImpersonating(rTokenTrader.address, async (rtokSigner) => {
        await token0.connect(rtokSigner).approve(broker.address, amount)
        await snapshotGasCost(broker.connect(rtokSigner).openTrade(tradeRequest))
      })
    })

    it('Initialize Trade ', async () => {
      // Fund trade and initialize
      await token0.connect(owner).mint(newTrade.address, amount)
      await snapshotGasCost(
        newTrade.init(
          broker.address,
          backingManager.address,
          gnosis.address,
          config.auctionLength,
          tradeRequest
        )
      )
    })

    it('Settle Trade ', async () => {
      // Fund trade and initialize
      await token0.connect(owner).mint(newTrade.address, amount)
      await newTrade.init(
        broker.address,
        backingManager.address,
        gnosis.address,
        config.auctionLength,
        tradeRequest
      )

      // Advance time till trade can be settled
      await advanceTime(config.auctionLength.add(100).toString())

      // Settle trade
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await snapshotGasCost(newTrade.connect(bmSigner).settle())
      })

      // Check status
      expect(await newTrade.status()).to.equal(TradeStatus.CLOSED)
      expect(await newTrade.canSettle()).to.equal(false)
    })
  })
})
