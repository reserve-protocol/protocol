import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { IConfig, MAX_AUCTION_LENGTH } from '../common/configuration'
import {
  MAX_UINT96,
  MAX_UINT192,
  TradeKind,
  TradeStatus,
  ZERO_ADDRESS,
  ONE_ADDRESS,
} from '../common/constants'
import { bn, fp, divCeil, toBNDecimals } from '../common/numbers'
import {
  DutchTrade,
  ERC20Mock,
  FiatCollateral,
  GnosisMock,
  GnosisMockReentrant,
  GnosisTrade,
  IAssetRegistry,
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
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'
import {
  advanceBlocks,
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
  getLatestBlockNumber,
} from './utils/time'
import { ITradeRequest } from './utils/trades'
import { useEnv } from '#/utils/env'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

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
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  let basket: Collateral[]
  let collateral: Collateral[]

  let prices: { sellLow: BigNumber; sellHigh: BigNumber; buyLow: BigNumber; buyHigh: BigNumber }

  beforeEach(async () => {
    ;[owner, addr1, mock, other] = await ethers.getSigners()
    // Deploy fixture
    ;({
      basket,
      config,
      main,
      assetRegistry,
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
    prices = { sellLow: fp('1'), sellHigh: fp('1'), buyLow: fp('1'), buyHigh: fp('1') }
  })

  describe('Deployment', () => {
    it('Should setup Broker correctly', async () => {
      expect(await broker.gnosis()).to.equal(gnosis.address)
      expect(await broker.batchAuctionLength()).to.equal(config.batchAuctionLength)
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)
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
        newBroker.init(main.address, ZERO_ADDRESS, ZERO_ADDRESS, bn('100'), ZERO_ADDRESS, bn('100'))
      ).to.be.revertedWith('invalid Gnosis address')
      await expect(
        newBroker.init(
          main.address,
          gnosis.address,
          ZERO_ADDRESS,
          bn('1000'),
          ZERO_ADDRESS,
          bn('1000')
        )
      ).to.be.revertedWith('invalid batchTradeImplementation address')
      await expect(
        newBroker.init(
          main.address,
          gnosis.address,
          ONE_ADDRESS,
          bn('1000'),
          ZERO_ADDRESS,
          bn('1000')
        )
      ).to.be.revertedWith('invalid dutchTradeImplementation address')
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

    it('Should allow to update BatchTrade Implementation if Owner and perform validations', async () => {
      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const tradeImpl: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Update to a trade implementation to use as baseline for tests
      await expect(broker.connect(owner).setBatchTradeImplementation(tradeImpl.address))
        .to.emit(broker, 'BatchTradeImplementationSet')
        .withArgs(anyValue, tradeImpl.address)

      // Check existing value
      expect(await broker.batchTradeImplementation()).to.equal(tradeImpl.address)

      // If not owner cannot update
      await expect(
        broker.connect(other).setBatchTradeImplementation(mock.address)
      ).to.be.revertedWith('governance only')

      // Check value did not change
      expect(await broker.batchTradeImplementation()).to.equal(tradeImpl.address)

      // Attempt to update with Owner but zero address - not allowed
      await expect(
        broker.connect(owner).setBatchTradeImplementation(ZERO_ADDRESS)
      ).to.be.revertedWith('invalid batchTradeImplementation address')

      // Update with owner
      await expect(broker.connect(owner).setBatchTradeImplementation(mock.address))
        .to.emit(broker, 'BatchTradeImplementationSet')
        .withArgs(tradeImpl.address, mock.address)

      // Check value was updated
      expect(await broker.batchTradeImplementation()).to.equal(mock.address)
    })

    it('Should allow to update DutchTrade Implementation if Owner and perform validations', async () => {
      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('DutchTrade')
      const tradeImpl: DutchTrade = <DutchTrade>await TradeFactory.deploy()

      // Update to a trade implementation to use as baseline for tests
      await expect(broker.connect(owner).setDutchTradeImplementation(tradeImpl.address))
        .to.emit(broker, 'DutchTradeImplementationSet')
        .withArgs(anyValue, tradeImpl.address)

      // Check existing value
      expect(await broker.dutchTradeImplementation()).to.equal(tradeImpl.address)

      // If not owner cannot update
      await expect(
        broker.connect(other).setDutchTradeImplementation(mock.address)
      ).to.be.revertedWith('governance only')

      // Check value did not change
      expect(await broker.dutchTradeImplementation()).to.equal(tradeImpl.address)

      // Attempt to update with Owner but zero address - not allowed
      await expect(
        broker.connect(owner).setDutchTradeImplementation(ZERO_ADDRESS)
      ).to.be.revertedWith('invalid dutchTradeImplementation address')

      // Update with owner
      await expect(broker.connect(owner).setDutchTradeImplementation(mock.address))
        .to.emit(broker, 'DutchTradeImplementationSet')
        .withArgs(tradeImpl.address, mock.address)

      // Check value was updated
      expect(await broker.dutchTradeImplementation()).to.equal(mock.address)
    })

    it('Should allow to update batchAuctionLength if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await broker.batchAuctionLength()).to.equal(config.batchAuctionLength)

      // If not owner cannot update
      await expect(broker.connect(other).setBatchAuctionLength(newValue)).to.be.revertedWith(
        'governance only'
      )

      // Check value did not change
      expect(await broker.batchAuctionLength()).to.equal(config.batchAuctionLength)

      // Update with owner
      await expect(broker.connect(owner).setBatchAuctionLength(newValue))
        .to.emit(broker, 'BatchAuctionLengthSet')
        .withArgs(config.batchAuctionLength, newValue)

      // Check value was updated
      expect(await broker.batchAuctionLength()).to.equal(newValue)
    })

    it('Should allow to update dutchAuctionLength if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await broker.dutchAuctionLength()).to.equal(config.dutchAuctionLength)

      // If not owner cannot update
      await expect(broker.connect(other).setDutchAuctionLength(newValue)).to.be.revertedWith(
        'governance only'
      )

      // Check value did not change
      expect(await broker.dutchAuctionLength()).to.equal(config.dutchAuctionLength)

      // Update with owner
      await expect(broker.connect(owner).setDutchAuctionLength(newValue))
        .to.emit(broker, 'DutchAuctionLengthSet')
        .withArgs(config.dutchAuctionLength, newValue)

      // Check value was updated
      expect(await broker.dutchAuctionLength()).to.equal(newValue)
    })

    it('Should perform validations on batchAuctionLength', async () => {
      let invalidValue: BigNumber = bn(1)

      // Attempt to update
      await expect(broker.connect(owner).setBatchAuctionLength(invalidValue)).to.be.revertedWith(
        'invalid batchAuctionLength'
      )

      invalidValue = bn(MAX_AUCTION_LENGTH + 1)

      // Attempt to update
      await expect(broker.connect(owner).setBatchAuctionLength(invalidValue)).to.be.revertedWith(
        'invalid batchAuctionLength'
      )

      // Allows to set it to zero to disable feature
      await expect(broker.connect(owner).setBatchAuctionLength(bn(0)))
        .to.emit(broker, 'BatchAuctionLengthSet')
        .withArgs(config.batchAuctionLength, bn(0))

      // Check value was updated
      expect(await broker.batchAuctionLength()).to.equal(bn(0))
    })

    it('Should perform validations on dutchAuctionLength', async () => {
      let invalidValue: BigNumber = bn(13)

      // Attempt to update
      await expect(broker.connect(owner).setDutchAuctionLength(invalidValue)).to.be.revertedWith(
        'invalid dutchAuctionLength'
      )

      invalidValue = bn(MAX_AUCTION_LENGTH + 1)

      // Attempt to update
      await expect(broker.connect(owner).setDutchAuctionLength(invalidValue)).to.be.revertedWith(
        'invalid dutchAuctionLength'
      )

      // Allows to set it to zero to disable feature
      await expect(broker.connect(owner).setDutchAuctionLength(bn(0)))
        .to.emit(broker, 'DutchAuctionLengthSet')
        .withArgs(config.dutchAuctionLength, bn(0))

      // Check value was updated
      expect(await broker.dutchAuctionLength()).to.equal(bn(0))
    })

    it('Should allow to update batchTradeDisabled/dutchTradeDisabled if Owner', async () => {
      // Check existing value
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)

      // If not owner cannot update
      await expect(broker.connect(other).setBatchTradeDisabled(true)).to.be.revertedWith(
        'governance only'
      )
      await expect(
        broker.connect(other).setDutchTradeDisabled(token0.address, true)
      ).to.be.revertedWith('governance only')

      // Check value did not change
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)

      // Update batchTradeDisabled with owner
      await expect(broker.connect(owner).setBatchTradeDisabled(true))
        .to.emit(broker, 'BatchTradeDisabledSet')
        .withArgs(false, true)

      // Check value was updated
      expect(await broker.batchTradeDisabled()).to.equal(true)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)

      // Update back to false
      await expect(broker.connect(owner).setBatchTradeDisabled(false))
        .to.emit(broker, 'BatchTradeDisabledSet')
        .withArgs(true, false)

      // Check value was updated
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)

      // Update dutchTradeDisabled with owner
      await expect(broker.connect(owner).setDutchTradeDisabled(token0.address, true))
        .to.emit(broker, 'DutchTradeDisabledSet')
        .withArgs(token0.address, false, true)

      // Check value was updated
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(true)
      expect(await broker.dutchTradeDisabled(token1.address)).to.equal(false)

      // Update back to false
      await expect(broker.connect(owner).setDutchTradeDisabled(token0.address, false))
        .to.emit(broker, 'DutchTradeDisabledSet')
        .withArgs(token0.address, true, false)

      // Check value was updated
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)
      expect(await broker.dutchTradeDisabled(token1.address)).to.equal(false)
    })
  })

  describe('Trade Management', () => {
    it('Should not allow to open Batch trade if Disabled', async () => {
      // Disable Broker Batch Auctions
      await expect(broker.connect(owner).setBatchTradeDisabled(true))
        .to.emit(broker, 'BatchTradeDisabledSet')
        .withArgs(false, true)

      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: bn('100e18'),
        minBuyAmount: bn('0'),
      }

      // Batch Auction openTrade should fail
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await expect(
          broker.connect(bmSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
        ).to.be.revertedWith('batch auctions disabled')
      })
    })

    it('Should not allow to open Dutch trade if Disabled for either token', async () => {
      const tradeRequest: ITradeRequest = {
        sell: collateral0.address,
        buy: collateral1.address,
        sellAmount: bn('100e18'),
        minBuyAmount: bn('0'),
      }
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await token0.mint(backingManager.address, tradeRequest.sellAmount)
        await token0.connect(bmSigner).approve(broker.address, tradeRequest.sellAmount)

        // Should succeed in callStatic
        await broker
          .connect(bmSigner)
          .callStatic.openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)

        // Disable Broker Dutch Auctions for token0
        await expect(broker.connect(owner).setDutchTradeDisabled(token0.address, true))
          .to.emit(broker, 'DutchTradeDisabledSet')
          .withArgs(token0.address, false, true)

        // Dutch Auction openTrade should fail now
        await expect(
          broker.connect(bmSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
        ).to.be.revertedWith('dutch auctions disabled for token pair')

        // Re-enable Dutch Auctions for token0
        await expect(broker.connect(owner).setDutchTradeDisabled(token0.address, false))
          .to.emit(broker, 'DutchTradeDisabledSet')
          .withArgs(token0.address, true, false)

        // Should succeed in callStatic
        await broker
          .connect(bmSigner)
          .callStatic.openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)

        // Disable Broker Dutch Auctions for token1
        await expect(broker.connect(owner).setDutchTradeDisabled(token1.address, true))
          .to.emit(broker, 'DutchTradeDisabledSet')
          .withArgs(token1.address, false, true)

        // Dutch Auction openTrade should fail now
        await expect(
          broker.connect(bmSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
        ).to.be.revertedWith('dutch auctions disabled for token pair')
      })
    })

    it('Should only allow to open trade if a trader', async () => {
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
      await expect(
        broker.connect(addr1).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
      ).to.be.revertedWith('only traders')

      // Open from traders - Should work
      // Backing Manager
      await whileImpersonating(backingManager.address, async (bmSigner) => {
        await token0.connect(bmSigner).approve(broker.address, amount)
        await expect(
          broker.connect(bmSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
        ).to.not.be.reverted
      })

      // RSR Trader
      await whileImpersonating(rsrTrader.address, async (rsrSigner) => {
        await token0.connect(rsrSigner).approve(broker.address, amount)
        await expect(
          broker.connect(rsrSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
        ).to.not.be.reverted
      })

      // RToken Trader
      await whileImpersonating(rTokenTrader.address, async (rtokSigner) => {
        await token0.connect(rtokSigner).approve(broker.address, amount)
        await expect(
          broker.connect(rtokSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
        ).to.not.be.reverted
      })
    })

    it('Should not allow to report violation if not trade contract', async () => {
      // Check not disabled
      expect(await broker.batchTradeDisabled()).to.equal(false)

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
      expect(await broker.batchTradeDisabled()).to.equal(false)
    })

    it('Should not allow to report violation if paused or frozen', async () => {
      // Check not disabled
      expect(await broker.batchTradeDisabled()).to.equal(false)

      await main.connect(owner).pauseTrading()

      await expect(broker.connect(addr1).reportViolation()).to.be.revertedWith(
        'frozen or trading paused'
      )

      await main.connect(owner).unpauseTrading()

      await main.connect(owner).freezeShort()

      await expect(broker.connect(addr1).reportViolation()).to.be.revertedWith(
        'frozen or trading paused'
      )

      // Check nothing changed
      expect(await broker.batchTradeDisabled()).to.equal(false)
    })
  })

  describe('Trades', () => {
    context('GnosisTrade', () => {
      const amount = bn('100e18')
      let trade: GnosisTrade

      beforeEach(async () => {
        // Create a Trade
        const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
        trade = <GnosisTrade>await TradeFactory.deploy()

        // Check state
        expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)
        expect(await trade.canSettle()).to.equal(false)
      })
      it('Should initialize GnosisTrade correctly - only once', async () => {
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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.not.be.reverted

        // Check trade values
        expect(await trade.KIND()).to.equal(TradeKind.BATCH_AUCTION)
        expect(await trade.gnosis()).to.equal(gnosis.address)
        expect(await trade.auctionId()).to.equal(0)
        expect(await trade.status()).to.equal(TradeStatus.OPEN)
        expect(await trade.broker()).to.equal(broker.address)
        expect(await trade.origin()).to.equal(backingManager.address)
        expect(await trade.sell()).to.equal(token0.address)
        expect(await trade.buy()).to.equal(token1.address)
        expect(await trade.initBal()).to.equal(amount)
        expect(await trade.endTime()).to.equal(
          (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength)
        )
        expect(await trade.worstCasePrice()).to.equal(bn('0'))
        expect(await trade.canSettle()).to.equal(false)

        // Attempt to initialize again
        await expect(
          trade.init(
            await trade.broker(),
            await trade.origin(),
            await trade.gnosis(),
            await broker.batchAuctionLength(),
            tradeRequest
          )
        ).to.be.revertedWith('Invalid trade state')
      })

      // This test is only here for coverage
      it('Should initialize GnosisTrade - zero decimal token', async () => {
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
            config.batchAuctionLength,
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
          (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength)
        )
        expect(await trade.worstCasePrice()).to.equal(bn('0'))
        expect(await trade.canSettle()).to.equal(false)
      })

      it('Should protect against reentrancy when initializing GnosisTrade', async () => {
        // Create a Reetrant Gnosis
        const GnosisReentrantFactory: ContractFactory = await ethers.getContractFactory(
          'GnosisMockReentrant'
        )
        const reentrantGnosis: GnosisMockReentrant = <GnosisMockReentrant>(
          await GnosisReentrantFactory.deploy()
        )
        await reentrantGnosis.setReenterOnInit(true)

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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.be.revertedWith('Invalid trade state')
      })

      it('Should perform balance and amounts validations on init', async () => {
        const invalidAmount: BigNumber = MAX_UINT96.add(1)

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
            config.batchAuctionLength,
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
            config.batchAuctionLength,
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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.be.revertedWith('initBal too large')
      })

      it('Should not allow to initialize an unfunded trade', async () => {
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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.be.revertedWith('unfunded trade')
      })

      it('Should be able to settle a trade - performing validations', async () => {
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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.not.be.reverted

        // Check trade is initialized but still cannot be settled
        expect(await trade.status()).to.equal(TradeStatus.OPEN)
        expect(await trade.canSettle()).to.equal(false)

        // Advance time till trade can be settled
        await advanceTime(config.batchAuctionLength.add(100).toString())

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

      it('Should protect against reentrancy when settling GnosisTrade', async () => {
        // Create a Reetrant Gnosis
        const GnosisReentrantFactory: ContractFactory = await ethers.getContractFactory(
          'GnosisMockReentrant'
        )
        const reentrantGnosis: GnosisMockReentrant = <GnosisMockReentrant>(
          await GnosisReentrantFactory.deploy()
        )
        await reentrantGnosis.setReenterOnInit(false)
        await reentrantGnosis.setReenterOnSettle(true)

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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.not.be.reverted

        // Advance time till trade can be settled
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Attempt Settle trade
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('Invalid trade state')
        })
      })

      it('Should be able to settle a GnosisTrade - handles arbitrary funds being sent to trade', async () => {
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
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.not.be.reverted

        // Check trade is initialized but still cannot be settled
        expect(await trade.status()).to.equal(TradeStatus.OPEN)
        expect(await trade.canSettle()).to.equal(false)

        // Advance time till trade can be settled
        await advanceTime(config.batchAuctionLength.add(100).toString())

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

      it('Should allow anyone to transfer to origin after a GnosisTrade is complete', async () => {
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
            config.batchAuctionLength,
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
        await advanceToTimestamp(await trade.endTime())

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

      // There is no test here for the reportViolation case; that is in Revenues.test.ts
    })

    context('DutchTrade', () => {
      let amount: BigNumber
      let trade: DutchTrade

      beforeEach(async () => {
        amount = config.rTokenMaxTradeVolume

        // Create a Trade
        const TradeFactory: ContractFactory = await ethers.getContractFactory('DutchTrade')
        trade = <DutchTrade>await TradeFactory.deploy()

        // Check state
        expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)
        expect(await trade.canSettle()).to.equal(false)
      })

      it('Should initialize DutchTrade correctly - only once', async () => {
        // Fund trade and initialize
        await token0.connect(owner).mint(trade.address, amount)
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.not.be.reverted

        // Check trade values
        expect(await trade.KIND()).to.equal(TradeKind.DUTCH_AUCTION)
        expect(await trade.status()).to.equal(TradeStatus.OPEN)
        expect(await trade.origin()).to.equal(backingManager.address)
        expect(await trade.sell()).to.equal(token0.address)
        expect(await trade.buy()).to.equal(token1.address)
        expect(await trade.sellAmount()).to.equal(amount)
        expect(await trade.startBlock()).to.equal((await getLatestBlockNumber()) + 1)
        const tradeLen = (await trade.endBlock()).sub(await trade.startBlock())
        expect(await trade.endTime()).to.equal(
          tradeLen.mul(12).add(await getLatestBlockTimestamp())
        )
        expect(await trade.bestPrice()).to.equal(
          divCeil(prices.sellHigh.mul(fp('1')), prices.buyLow)
        )
        expect(await trade.worstPrice()).to.equal(prices.sellLow.mul(fp('1')).div(prices.buyHigh))
        expect(await trade.canSettle()).to.equal(false)

        // Attempt to initialize again
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.be.revertedWith('Invalid trade state')
      })

      it('Should not initialize DutchTrade with bad prices', async () => {
        // Fund trade
        await token0.connect(owner).mint(trade.address, amount)

        // Attempt to initialize with bad sell price
        prices.sellLow = bn('0')
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.be.revertedWith('bad sell pricing')

        prices.sellLow = fp('1')
        prices.buyHigh = MAX_UINT192

        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.be.revertedWith('bad buy pricing')
      })

      it('Should apply full maxTradeSlippage to lowPrice at minTradeVolume', async () => {
        amount = config.minTradeVolume

        // Fund trade and initialize
        await token0.connect(owner).mint(trade.address, amount)
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.not.be.reverted

        // Check trade values
        expect(await trade.bestPrice()).to.equal(
          divCeil(prices.sellHigh.mul(fp('1')), prices.buyLow)
        )
        const withoutSlippage = prices.sellLow.mul(fp('1')).div(prices.buyHigh)
        const withSlippage = withoutSlippage.sub(
          withoutSlippage.mul(config.maxTradeSlippage).div(fp('1'))
        )
        expect(await trade.worstPrice()).to.be.closeTo(withSlippage, withSlippage.div(bn('1e9')))
      })

      it('Should apply full maxTradeSlippage with low maxTradeVolume', async () => {
        // Set low maxTradeVolume for collateral
        const FiatCollateralFactory = await ethers.getContractFactory('FiatCollateral')
        const newCollateral0: FiatCollateral = <FiatCollateral>await FiatCollateralFactory.deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral0.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: token0.address,
          maxTradeVolume: bn(500),
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        })

        // Refresh and swap collateral
        await newCollateral0.refresh()
        await assetRegistry.connect(owner).swapRegistered(newCollateral0.address)

        // Fund trade and initialize
        await token0.connect(owner).mint(trade.address, amount)
        await expect(
          trade.init(
            backingManager.address,
            newCollateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.not.be.reverted

        // Check trade values
        expect(await trade.bestPrice()).to.equal(
          divCeil(prices.sellHigh.mul(fp('1')), prices.buyLow)
        )
        const withoutSlippage = prices.sellLow.mul(fp('1')).div(prices.buyHigh)
        const withSlippage = withoutSlippage.sub(
          withoutSlippage.mul(config.maxTradeSlippage).div(fp('1'))
        )
        expect(await trade.worstPrice()).to.be.closeTo(withSlippage, withSlippage.div(bn('1e9')))
      })

      it('Should not allow to initialize an unfunded trade', async () => {
        // Attempt to initialize without funding
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.be.revertedWith('unfunded trade')
      })

      it('Should not allow to settle until auction is over', async () => {
        // Fund trade and initialize
        await token0.connect(owner).mint(trade.address, amount)
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.not.be.reverted

        // Should not be able to settle
        expect(await trade.canSettle()).to.equal(false)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('auction not over')
        })

        // Advance blocks til trade can be settled
        const tradeLen = (await trade.endBlock()).sub(await getLatestBlockNumber())
        await advanceBlocks(tradeLen.add(1))

        // Settle trade
        expect(await trade.canSettle()).to.equal(true)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await expect(trade.connect(bmSigner).settle()).to.not.be.reverted
        })

        // Cannot settle again with trade closed
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await expect(trade.connect(bmSigner).settle()).to.be.revertedWith('Invalid trade state')
        })
      })

      it('Should allow anyone to transfer to origin after a DutchTrade is complete', async () => {
        // Fund trade and initialize
        await token0.connect(owner).mint(trade.address, amount)
        await expect(
          trade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        ).to.not.be.reverted

        // Check balances on Trade and Origin
        expect(await token0.balanceOf(trade.address)).to.equal(amount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)

        // Attempt to transfer the new funds to origin while the Trade is still open
        await expect(trade.transferToOriginAfterTradeComplete(token0.address)).to.be.revertedWith(
          'only after trade is closed'
        )

        // Advance blocks til trade can be settled
        const tradeLen = (await trade.endBlock()).sub(await getLatestBlockNumber())
        await advanceBlocks(tradeLen.add(1))

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

      // There is no test here for the reportViolation case; that is in Revenues.test.ts
    })
  })

  describeGas('Gas Reporting', () => {
    context('GnosisTrade', () => {
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
          await snapshotGasCost(
            broker.connect(bmSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
          )
        })

        // RSR Trader
        await whileImpersonating(rsrTrader.address, async (rsrSigner) => {
          await token0.connect(rsrSigner).approve(broker.address, amount)
          await snapshotGasCost(
            broker.connect(rsrSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
          )
        })

        // RToken Trader
        await whileImpersonating(rTokenTrader.address, async (rtokSigner) => {
          await token0.connect(rtokSigner).approve(broker.address, amount)
          await snapshotGasCost(
            broker.connect(rtokSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
          )
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
            config.batchAuctionLength,
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
          config.batchAuctionLength,
          tradeRequest
        )

        // Advance time till trade can be settled
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Settle trade
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await snapshotGasCost(newTrade.connect(bmSigner).settle())
        })

        // Check status
        expect(await newTrade.status()).to.equal(TradeStatus.CLOSED)
        expect(await newTrade.canSettle()).to.equal(false)
      })
    })

    context('DutchTrade', () => {
      let amount: BigNumber
      let tradeRequest: ITradeRequest
      let TradeFactory: ContractFactory
      let newTrade: DutchTrade

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
        TradeFactory = await ethers.getContractFactory('DutchTrade')
        newTrade = <DutchTrade>await TradeFactory.deploy()
      })

      it('Open Trade ', async () => {
        // Open from traders
        // Backing Manager
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await token0.connect(bmSigner).approve(broker.address, amount)
          await snapshotGasCost(
            broker.connect(bmSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
          )
        })

        // RSR Trader
        await whileImpersonating(rsrTrader.address, async (rsrSigner) => {
          await token0.connect(rsrSigner).approve(broker.address, amount)
          await snapshotGasCost(
            broker.connect(rsrSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
          )
        })

        // RToken Trader
        await whileImpersonating(rTokenTrader.address, async (rtokSigner) => {
          await token0.connect(rtokSigner).approve(broker.address, amount)
          await snapshotGasCost(
            broker.connect(rtokSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
          )
        })
      })

      it('Initialize Trade ', async () => {
        // Fund trade and initialize
        await token0.connect(owner).mint(newTrade.address, amount)
        await snapshotGasCost(
          newTrade.init(
            backingManager.address,
            collateral0.address,
            collateral1.address,
            amount,
            config.dutchAuctionLength,
            prices
          )
        )
      })

      it('Settle Trade ', async () => {
        // Fund trade and initialize
        await token0.connect(owner).mint(newTrade.address, amount)
        await newTrade.init(
          backingManager.address,
          collateral0.address,
          collateral1.address,
          amount,
          config.dutchAuctionLength,
          prices
        )

        // Advance time till trade can be settled
        await advanceTime(config.dutchAuctionLength.add(100).toString())

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
})
