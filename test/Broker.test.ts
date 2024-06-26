import { loadFixture, getStorageAt, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { BigNumber, ContractFactory, constants } from 'ethers'
import hre, { ethers, upgrades } from 'hardhat'
import { IConfig, MAX_AUCTION_LENGTH } from '../common/configuration'
import {
  MAX_UINT48,
  MAX_UINT96,
  MAX_UINT192,
  TradeKind,
  TradeStatus,
  ZERO_ADDRESS,
  ONE_ADDRESS,
  BidType,
} from '../common/constants'
import { bn, fp, divCeil, shortString, toBNDecimals } from '../common/numbers'
import {
  DutchTrade,
  ERC20Mock,
  FiatCollateral,
  GnosisMock,
  GnosisMockReentrant,
  GnosisTrade,
  GnosisTrade__factory,
  IAssetRegistry,
  TestIBackingManager,
  TestIBasketHandler,
  TestIBroker,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  USDCMock,
  ZeroDecimalMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import { cartesianProduct } from './utils/cases'
import {
  Collateral,
  DefaultFixture,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  SLOW,
  VERSION,
} from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'
import {
  advanceBlocks,
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from './utils/time'
import { ITradeRequest, disableBatchTrade, disableDutchTrade, getTrade } from './utils/trades'
import { useEnv } from '#/utils/env'
import { parseUnits } from 'ethers/lib/utils'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const describeExtreme =
  IMPLEMENTATION == Implementation.P1 && useEnv('EXTREME') ? describe.only : describe.skip

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
  let basketHandler: TestIBasketHandler
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let rToken: TestIRToken

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
      basketHandler,
      broker,
      gnosis,
      rsrTrader,
      rTokenTrader,
      rToken,
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
      const upgraderAddr = IMPLEMENTATION == Implementation.P1 ? main.address : owner.address
      const errorMsg = IMPLEMENTATION == Implementation.P1 ? 'main only' : 'governance only'

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const tradeImpl: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      // Update to a trade implementation to use as baseline for tests
      await whileImpersonating(upgraderAddr, async (upgSigner) => {
        await expect(broker.connect(upgSigner).setBatchTradeImplementation(tradeImpl.address))
          .to.emit(broker, 'BatchTradeImplementationSet')
          .withArgs(anyValue, tradeImpl.address)
      })

      // Check existing value
      expect(await broker.batchTradeImplementation()).to.equal(tradeImpl.address)

      // If not owner cannot update
      await expect(
        broker.connect(other).setBatchTradeImplementation(mock.address)
      ).to.be.revertedWith(errorMsg)

      // Check value did not change
      expect(await broker.batchTradeImplementation()).to.equal(tradeImpl.address)

      // Attempt to update with Owner but zero address - not allowed
      await whileImpersonating(upgraderAddr, async (upgSigner) => {
        await expect(
          broker.connect(upgSigner).setBatchTradeImplementation(ZERO_ADDRESS)
        ).to.be.revertedWith('invalid batchTradeImplementation address')

        // Update with owner
        await expect(broker.connect(upgSigner).setBatchTradeImplementation(mock.address))
          .to.emit(broker, 'BatchTradeImplementationSet')
          .withArgs(tradeImpl.address, mock.address)
      })
      // Check value was updated
      expect(await broker.batchTradeImplementation()).to.equal(mock.address)
    })

    it('Should allow to update DutchTrade Implementation if Owner and perform validations', async () => {
      const upgraderAddr = IMPLEMENTATION == Implementation.P1 ? main.address : owner.address
      const errorMsg = IMPLEMENTATION == Implementation.P1 ? 'main only' : 'governance only'

      // Create a Trade
      const TradeFactory: ContractFactory = await ethers.getContractFactory('DutchTrade')
      const tradeImpl: DutchTrade = <DutchTrade>await TradeFactory.deploy()

      // Update to a trade implementation to use as baseline for tests
      await whileImpersonating(upgraderAddr, async (upgSigner) => {
        await expect(broker.connect(upgSigner).setDutchTradeImplementation(tradeImpl.address))
          .to.emit(broker, 'DutchTradeImplementationSet')
          .withArgs(anyValue, tradeImpl.address)
      })

      // Check existing value
      expect(await broker.dutchTradeImplementation()).to.equal(tradeImpl.address)

      // If not owner cannot update
      await expect(
        broker.connect(other).setDutchTradeImplementation(mock.address)
      ).to.be.revertedWith(errorMsg)

      // Check value did not change
      expect(await broker.dutchTradeImplementation()).to.equal(tradeImpl.address)

      // Attempt to update with Owner but zero address - not allowed
      await whileImpersonating(upgraderAddr, async (upgSigner) => {
        await expect(
          broker.connect(upgSigner).setDutchTradeImplementation(ZERO_ADDRESS)
        ).to.be.revertedWith('invalid dutchTradeImplementation address')

        // Update with owner
        await expect(broker.connect(upgSigner).setDutchTradeImplementation(mock.address))
          .to.emit(broker, 'DutchTradeImplementationSet')
          .withArgs(tradeImpl.address, mock.address)
      })

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
      await expect(broker.connect(other).enableBatchTrade()).to.be.revertedWith('governance only')
      await expect(broker.connect(other).enableDutchTrade(token0.address)).to.be.revertedWith(
        'governance only'
      )

      // Check value did not change
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)

      // Disable batch trade manually
      await disableBatchTrade(broker)
      expect(await broker.batchTradeDisabled()).to.equal(true)

      // Enable batch trade with owner
      await expect(broker.connect(owner).enableBatchTrade())
        .to.emit(broker, 'BatchTradeDisabledSet')
        .withArgs(true, false)

      // Check value was updated
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)

      // Disable dutch trade manually
      await disableDutchTrade(broker, token0.address)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(true)

      // Enable dutch trade with owner
      await expect(broker.connect(owner).enableDutchTrade(token0.address))
        .to.emit(broker, 'DutchTradeDisabledSet')
        .withArgs(token0.address, true, false)

      // Check value was updated
      expect(await broker.batchTradeDisabled()).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)
      expect(await broker.dutchTradeDisabled(token0.address)).to.equal(false)
      expect(await broker.dutchTradeDisabled(token1.address)).to.equal(false)
    })
  })

  describe('Trade Management', () => {
    it('Should not allow to open Batch trade if Disabled', async () => {
      // Disable Broker Batch Auctions
      await disableBatchTrade(broker)

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
        await assetRegistry.refresh()
        await broker
          .connect(bmSigner)
          .callStatic.openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)

        // Disable Broker Dutch Auctions for token0
        await disableDutchTrade(broker, token0.address)

        // Dutch Auction openTrade should fail now
        await expect(
          broker.connect(bmSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
        ).to.be.revertedWith('dutch auctions disabled for token pair')

        // Re-enable Dutch Auctions for token0
        await expect(broker.connect(owner).enableDutchTrade(token0.address))
          .to.emit(broker, 'DutchTradeDisabledSet')
          .withArgs(token0.address, true, false)

        // Should succeed in callStatic
        await assetRegistry.refresh()
        await broker
          .connect(bmSigner)
          .callStatic.openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)

        // Disable Broker Dutch Auctions for token1
        await disableDutchTrade(broker, token1.address)

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
  })

  describe('Trades', () => {
    context('GnosisTrade', () => {
      const amount = fp('100.0')
      let trade: GnosisTrade

      beforeEach(async () => {
        // Create a Trade
        const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
        trade = <GnosisTrade>await TradeFactory.deploy()

        await setStorageAt(trade.address, 0, 0)

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

        // Will initialize correctly
        await expect(
          trade.init(
            broker.address,
            backingManager.address,
            gnosis.address,
            config.batchAuctionLength,
            tradeRequest
          )
        ).to.not.be.reverted
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

      it('Settle frontrun regression check - should be OK', async () => {
        // Initialize trade - simulate from backingManager
        // token0 18 decimals
        // token1 6 decimals
        const tradeRequest: ITradeRequest = {
          sell: collateral0.address,
          buy: collateral1.address,
          sellAmount: fp('100.0'),
          minBuyAmount: parseUnits('95.0', 6),
        }

        // Fund trade and initialize
        await token0.connect(owner).mint(backingManager.address, tradeRequest.sellAmount)

        let newTradeAddress = ''
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await token0.connect(bmSigner).approve(broker.address, tradeRequest.sellAmount)
          const brokerWithBM = broker.connect(bmSigner)
          newTradeAddress = await brokerWithBM.callStatic.openTrade(
            TradeKind.BATCH_AUCTION,
            tradeRequest,
            prices
          )
          await brokerWithBM.openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
        })
        trade = GnosisTrade__factory.connect(newTradeAddress, owner)

        await advanceTime(config.batchAuctionLength.div(10).toString())

        // Place minimum bid
        const bid = {
          bidder: addr1.address,
          sellAmount: tradeRequest.sellAmount,
          buyAmount: tradeRequest.minBuyAmount,
        }
        await token1.connect(owner).mint(addr1.address, bid.buyAmount)
        await token1.connect(addr1).approve(gnosis.address, bid.buyAmount)
        await gnosis.placeBid(0, bid)

        // Advance time till trade can be settled
        await advanceTime(config.batchAuctionLength.add(100).toString())

        await whileImpersonating(backingManager.address, async (bmSigner) => {
          const tradeWithBm = GnosisTrade__factory.connect(newTradeAddress, bmSigner)

          const normalValues = await tradeWithBm.callStatic.settle()

          expect(normalValues.boughtAmt).to.eq(tradeRequest.minBuyAmount)
          expect(normalValues.soldAmt).to.eq(tradeRequest.sellAmount)

          // Simulate someone frontrunning settlement and adding more funds to the trade
          await token0.connect(owner).mint(tradeWithBm.address, fp('10'))
          await token1.connect(owner).mint(tradeWithBm.address, parseUnits('1', 6))

          // Simulate settlement after manipulating the trade
          let frontRunnedValues = await tradeWithBm.callStatic.settle()
          expect(frontRunnedValues.boughtAmt).to.eq(
            tradeRequest.minBuyAmount.add(parseUnits('1', 6))
          )
          expect(frontRunnedValues.soldAmt).to.eq(tradeRequest.sellAmount.sub(fp('10')))
          // We can manipulate boughtAmt up and soldAmt down.
          // So we're unable to manipualte the clearing price down and force a violation.

          // uint192 clearingPrice = shiftl_toFix(adjustedBuyAmt, -int8(buy.decimals())).div(
          //   shiftl_toFix(adjustedSoldAmt, -int8(sell.decimals()))
          // );
          // if (clearingPrice.lt(worstCasePrice)) {
          //   broker.reportViolation();
          // }
          await token0.connect(owner).mint(tradeWithBm.address, fp('10'))
          await token1.connect(owner).mint(tradeWithBm.address, parseUnits('1', 6))
          frontRunnedValues = await tradeWithBm.callStatic.settle()
          expect(frontRunnedValues.boughtAmt).to.eq(
            tradeRequest.minBuyAmount.add(parseUnits('2', 6))
          )
          expect(frontRunnedValues.soldAmt).to.eq(tradeRequest.sellAmount.sub(fp('20')))

          expect(await broker.batchTradeDisabled()).to.be.false
          await tradeWithBm.settle()
          expect(await broker.batchTradeDisabled()).to.be.false
        })

        // Check status
        expect(await trade.status()).to.equal(TradeStatus.CLOSED)
        expect(await trade.canSettle()).to.equal(false)

        // It's potentially possible to prevent the reportViolation call to be called
        // if (sellBal < initBal) {
        // if sellBal get's set to initBal, then the GnosisTrade will ignore the boughtAmt
        // But it's unknown if this could be exploited
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

      it('Should downsize trades above uint96 - sell side', async () => {
        const tradeRequest: ITradeRequest = {
          sell: collateral0.address,
          buy: collateral1.address,
          sellAmount: MAX_UINT96.add(1),
          minBuyAmount: amount,
        }

        // Should open trade JUST on MAX_UINT96 approval, not MAX_UINT96 + 1
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await token0.mint(backingManager.address, MAX_UINT96)
          await token0.connect(bmSigner).approve(broker.address, MAX_UINT96)
          await broker.connect(bmSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
          // should not revert
        })
      })

      it('Should downsize trades above uint96 - buy side', async () => {
        const tradeRequest: ITradeRequest = {
          sell: collateral0.address,
          buy: collateral1.address,
          sellAmount: amount,
          minBuyAmount: MAX_UINT96.add(1),
        }

        // Should open trade JUST on amount - 1 approval, not amount
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await token0.mint(backingManager.address, amount.sub(1))
          await token0.connect(bmSigner).approve(broker.address, amount.sub(1))
          await broker.connect(bmSigner).openTrade(TradeKind.BATCH_AUCTION, tradeRequest, prices)
          // should not revert
        })
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

        await setStorageAt(trade.address, 0, 0)

        // Check state
        expect(await trade.status()).to.equal(TradeStatus.NOT_STARTED)
        expect(await trade.canSettle()).to.equal(false)
      })

      it('Should have version()', async () => {
        expect(await trade.version()).to.equal(VERSION)
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
        expect(await trade.startTime()).to.equal((await getLatestBlockTimestamp()) + 1)
        const tradeLen = (await trade.endTime()) - (await trade.startTime())
        expect(await trade.endTime()).to.equal(tradeLen + 1 + (await getLatestBlockTimestamp()))
        expect(await trade.bestPrice()).to.equal(
          divCeil(prices.sellHigh.mul(fp('1')), prices.buyLow)
        )
        const worstPrice = prices.sellLow
          .mul(fp('1').sub(await backingManager.maxTradeSlippage()))
          .div(prices.buyHigh)
        expect(await trade.worstPrice()).to.equal(worstPrice)
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
        const now = await getLatestBlockTimestamp()
        const tradeLen = (await trade.endTime()) - now
        await advanceToTimestamp(now + tradeLen + 1)

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
        const now = await getLatestBlockTimestamp()
        const tradeLen = (await trade.endTime()) - now
        await advanceToTimestamp(now + tradeLen + 1)

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

  describeExtreme(`Extreme Values ${SLOW ? 'slow mode' : 'fast mode'}`, () => {
    if (!(Implementation.P1 && useEnv('EXTREME'))) return // prevents bunch of skipped tests

    async function runScenario([
      bidType,
      sellTokDecimals,
      buyTokDecimals,
      auctionSellAmt,
      progression,
    ]: BigNumber[]) {
      const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
      // Factories
      const ERC20Factory = await ethers.getContractFactory('ERC20MockDecimals')
      const CollFactory = await ethers.getContractFactory('FiatCollateral')
      const sellTok = await ERC20Factory.deploy('Sell Token', 'SELL', sellTokDecimals)
      const buyTok = await ERC20Factory.deploy('Buy Token', 'BUY', buyTokDecimals)
      const sellColl = <FiatCollateral>await CollFactory.deploy({
        priceTimeout: MAX_UINT48,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: bn('1'), // minimize
        erc20: sellTok.address,
        maxTradeVolume: MAX_UINT192,
        oracleTimeout: MAX_UINT48.sub(300),
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01'), // shouldn't matter
        delayUntilDefault: bn('604800'), // shouldn't matter
      })
      await assetRegistry.connect(owner).register(sellColl.address)
      const buyColl = <FiatCollateral>await CollFactory.deploy({
        priceTimeout: MAX_UINT48,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: bn('1'), // minimize
        erc20: buyTok.address,
        maxTradeVolume: MAX_UINT192,
        oracleTimeout: MAX_UINT48.sub(300),
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01'), // shouldn't matter
        delayUntilDefault: bn('604800'), // shouldn't matter
      })
      await assetRegistry.connect(owner).register(buyColl.address)

      // Set basket
      await basketHandler
        .connect(owner)
        .setPrimeBasket([sellTok.address, buyTok.address], [fp('0.5'), fp('0.5')])
      await basketHandler.connect(owner).refreshBasket()

      const MAX_ERC20_SUPPLY = bn('1e48') // from docs/solidity-style.md

      const MAX_BUY_TOKEN_SCALED = toBNDecimals(MAX_ERC20_SUPPLY, Number(buyTokDecimals))
      const MAX_SELL_TOKEN_SCALED = toBNDecimals(MAX_ERC20_SUPPLY, Number(sellTokDecimals))

      // Max out throttles
      const issuanceThrottleParams = { amtRate: MAX_ERC20_SUPPLY, pctRate: 0 }
      const redemptionThrottleParams = { amtRate: MAX_ERC20_SUPPLY, pctRate: 0 }
      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)
      await advanceTime(3600)

      // Mint coll tokens to addr1
      await buyTok.connect(owner).mint(addr1.address, MAX_BUY_TOKEN_SCALED)
      await sellTok.connect(owner).mint(addr1.address, MAX_SELL_TOKEN_SCALED)

      // Issue RToken
      await buyTok.connect(addr1).approve(rToken.address, MAX_BUY_TOKEN_SCALED)
      await sellTok.connect(addr1).approve(rToken.address, MAX_SELL_TOKEN_SCALED)
      await rToken.connect(addr1).issue(MAX_ERC20_SUPPLY.div(2))

      // Burn buyTok from backingManager and send extra sellTok
      const burnAmount = divCeil(
        auctionSellAmt.mul(bn(10).pow(buyTokDecimals)),
        bn(10).pow(sellTokDecimals)
      )
      await buyTok.burn(backingManager.address, burnAmount)
      await sellTok
        .connect(addr1)
        .transfer(backingManager.address, auctionSellAmt.mul(bn(10).pow(sellTokDecimals)))

      // Rebalance should cause backingManager to trade about auctionSellAmt, though not exactly
      await backingManager.setMaxTradeSlippage(bn('0'))
      await backingManager.setMinTradeVolume(bn('0'))
      await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION))
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(anyValue, sellTok.address, buyTok.address, anyValue, anyValue)

      // Get Trade
      const tradeAddr = await backingManager.trades(sellTok.address)
      const trade = await ethers.getContractAt('DutchTrade', tradeAddr)
      const startTime = await trade.startTime()
      const endTime = await trade.endTime()
      const bidTime =
        startTime +
        progression
          .mul(endTime - startTime)
          .div(fp('1'))
          .toNumber()
      const bidAmt = await trade.bidAmount(bidTime)

      // Bid
      const sellAmt = await trade.lot()
      expect(bidAmt).to.be.gt(0)
      const buyBalBefore = await buyTok.balanceOf(backingManager.address)
      const sellBalBefore = await sellTok.balanceOf(addr1.address)

      if (bidTime > (await getLatestBlockTimestamp())) await setNextBlockTimestamp(bidTime)

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      if (bidType.eq(bn(BidType.CALLBACK))) {
        await buyTok.connect(addr1).approve(router.address, constants.MaxUint256)
        await router.connect(addr1).bid(trade.address, addr1.address)
      } else if (bidType.eq(bn(BidType.TRANSFER))) {
        await buyTok.connect(addr1).approve(tradeAddr, MAX_BUY_TOKEN_SCALED)
        await trade.connect(addr1).bid()
      }
      await advanceBlocks(1)
      await hre.network.provider.send('evm_setAutomine', [true])

      // Check balances
      expect(await sellTok.balanceOf(addr1.address)).to.equal(sellBalBefore.add(sellAmt))
      expect(await buyTok.balanceOf(backingManager.address)).to.equal(buyBalBefore.add(bidAmt))
      expect(await sellTok.balanceOf(trade.address)).to.equal(0)
      expect(await buyTok.balanceOf(trade.address)).to.equal(0)

      // Check disabled status
      const shouldDisable = progression.lt(fp('0.2'))
      expect(await broker.dutchTradeDisabled(sellTok.address)).to.equal(shouldDisable)
      expect(await broker.dutchTradeDisabled(buyTok.address)).to.equal(shouldDisable)
    }

    // ==== Generate the tests ====

    const bidTypes = [bn(BidType.CALLBACK), bn(BidType.TRANSFER)]

    // applied to both buy and sell tokens
    const decimals = [bn('1'), bn('6'), bn('18'), bn('27')]

    // auction sell amount
    const auctionSellAmts = [bn('2'), bn('1595439874635'), bn('987321984732198435645846513')]

    // auction progression %: these will get rounded to blocks later
    const progression = [fp('0'), fp('0.321698432589749813'), fp('0.798138321987329646'), fp('1')]

    // total cases is 2 * 4 * 4 * 3 * 4 = 384

    if (SLOW) {
      decimals.push(bn('8'), bn('9'), bn('21'))
      progression.push(fp('0.176334768961354965'), fp('0.523449931646439834'))

      // total cases is 2 * 7 * 7 * 3 * 6 = 1764
    }

    const paramList = cartesianProduct(bidTypes, decimals, decimals, auctionSellAmts, progression)

    const numCases = paramList.length.toString()
    paramList.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(params)
      })
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
        await setStorageAt(newTrade.address, 0, 0)
      })

      it('Should have version()', async () => {
        expect(await newTrade.version()).to.equal(VERSION)
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

      // Bidding tested in Revenues.test.ts

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

      // Increment `lastSave` in storage slot 1
      const incrementLastSave = async (addr: string) => {
        const asArray = ethers.utils.arrayify(await getStorageAt(addr, 1))
        asArray[7] = asArray[7] + 1 // increment least significant byte of lastSave
        const asHex = ethers.utils.hexlify(asArray)
        await setStorageAt(addr, 1, asHex)
      }

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
        await setStorageAt(newTrade.address, 0, 0)
      })

      it('Open Trade ', async () => {
        // Open from traders
        // Backing Manager
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await token0.connect(bmSigner).approve(broker.address, amount)
          await assetRegistry.refresh()
          await incrementLastSave(tradeRequest.sell)
          await incrementLastSave(tradeRequest.buy)
          await snapshotGasCost(
            broker.connect(bmSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
          )
        })

        // RSR Trader
        await whileImpersonating(rsrTrader.address, async (rsrSigner) => {
          await token0.connect(rsrSigner).approve(broker.address, amount)
          await assetRegistry.refresh()
          await incrementLastSave(tradeRequest.sell)
          await incrementLastSave(tradeRequest.buy)
          await snapshotGasCost(
            broker.connect(rsrSigner).openTrade(TradeKind.DUTCH_AUCTION, tradeRequest, prices)
          )
        })

        // RToken Trader
        await whileImpersonating(rTokenTrader.address, async (rtokSigner) => {
          await token0.connect(rtokSigner).approve(broker.address, amount)
          await assetRegistry.refresh()
          await incrementLastSave(tradeRequest.sell)
          await incrementLastSave(tradeRequest.buy)
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

      // Bidding tested in Revenues.test.ts

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
        await advanceToTimestamp(await newTrade.endTime())

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
