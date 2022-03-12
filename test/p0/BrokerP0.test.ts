import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn } from '../../common/numbers'
import { BrokerP0, ERC20Mock, MainP0, GnosisMock } from '../../typechain'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('BrokerP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Trading
  let gnosis: GnosisMock
  let broker: BrokerP0

  let erc20s: ERC20Mock[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let main: MainP0

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
    ;({ erc20s, collateral, basket, config, main, gnosis, broker } = await loadFixture(
      defaultFixture
    ))
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
})
