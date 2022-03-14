import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn } from '../../common/numbers'
import {
  BackingManagerP0,
  BrokerP0,
  ERC20Mock,
  GnosisMock,
  MainP0,
  RevenueTradingP0,
  USDCMock,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'
import { ITradeRequest } from './utils/trades'

const createFixtureLoader = waffle.createFixtureLoader

describe('BrokerP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Assets / Tokens
  let collateral0: Collateral
  let collateral1: Collateral
  let token0: ERC20Mock
  let token1: ERC20Mock
  let collateral: Collateral[]

  // Trading
  let gnosis: GnosisMock
  let broker: BrokerP0

  let erc20s: ERC20Mock[]

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
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    // Deploy fixture
    ;({
      erc20s,
      collateral,
      basket,
      config,
      main,
      backingManager,
      broker,
      gnosis,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))

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

  describe('Trades', () => {
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

    it('Should allow trade contract to report violation', async () => {
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
})
