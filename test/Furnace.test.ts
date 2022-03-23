import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { ZERO_ADDRESS } from '../common/constants'
import { bn } from '../common/numbers'
import {
  CTokenMock,
  ERC20Mock,
  FacadeP0,
  FurnaceP0,
  MainP0,
  TestIRToken,
  StaticATokenMock,
  USDCMock,
} from '../typechain'
import { advanceTime } from './utils/time'
import { Collateral, defaultFixture, IConfig } from './fixtures'
import { makeDecayFn } from './utils/rewards'

const createFixtureLoader = waffle.createFixtureLoader

describe('FurnaceP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Contracts
  let FurnaceFactory: ContractFactory
  let main: MainP0
  let furnace: FurnaceP0
  let rToken: TestIRToken
  let basket: Collateral[]
  let facade: FacadeP0

  // Config
  let config: IConfig

  // Tokens/Assets
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: StaticATokenMock
  let token3: CTokenMock

  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: Collateral
  let collateral3: Collateral

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({ main, basket, rToken, furnace, config, facade } = await loadFixture(defaultFixture))

    // Setup issuance of RTokens for users
    initialBal = bn('100e18')

    // Get assets and tokens
    ;[collateral0, collateral1, collateral2, collateral3] = basket

    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())

    // Mint Tokens
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)

    // Set Furnace Factory
    FurnaceFactory = await ethers.getContractFactory('FurnaceP0')
  })

  describe('Deployment', () => {
    it('Deployment should setup Furnace correctly', async () => {
      expect(await furnace.period()).to.equal(config.rewardPeriod)
      expect(await furnace.ratio()).to.equal(config.rewardRatio)
      expect(await furnace.lastPayout()).to.be.gt(0) // A timestamp is set
      expect(await furnace.main()).to.equal(main.address)
    })

    it('Deployment does not accept empty period', async () => {
      const newConfig = JSON.parse(JSON.stringify(config))
      newConfig.rewardPeriod = bn('0')
      const newFurnace = await FurnaceFactory.deploy()
      await expect(
        newFurnace.initComponent(main.address, {
          params: newConfig,
          components: {
            rToken: ZERO_ADDRESS,
            stRSR: ZERO_ADDRESS,
            assetRegistry: ZERO_ADDRESS,
            basketHandler: ZERO_ADDRESS,
            backingManager: ZERO_ADDRESS,
            distributor: ZERO_ADDRESS,
            rsrTrader: ZERO_ADDRESS,
            rTokenTrader: ZERO_ADDRESS,
            furnace: ZERO_ADDRESS,
            broker: ZERO_ADDRESS,
          },
          gnosis: ZERO_ADDRESS,
          assets: [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
          rsr: ZERO_ADDRESS,
        })
      ).to.be.revertedWith('period cannot be zero')
    })
  })

  describe('Configuration / State', () => {
    it('Should allow to update period correctly if Owner and perform validations', async () => {
      // Setup a new value
      const newRewardPeriod: BigNumber = bn('100000')

      await expect(furnace.connect(owner).setPeriod(newRewardPeriod))
        .to.emit(furnace, 'PeriodSet')
        .withArgs(config.rewardPeriod, newRewardPeriod)

      expect(await furnace.period()).to.equal(newRewardPeriod)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setPeriod(bn('500'))).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Cannot update with period zero
      await expect(furnace.connect(owner).setPeriod(bn('0'))).to.be.revertedWith(
        'period cannot be zero'
      )
    })

    it('Should allow to update ratio correctly if Owner', async () => {
      // Setup a new value
      const newRatio: BigNumber = bn('100000')

      await expect(furnace.connect(owner).setRatio(newRatio))
        .to.emit(furnace, 'RatioSet')
        .withArgs(config.rewardRatio, newRatio)

      expect(await furnace.ratio()).to.equal(newRatio)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setRatio(bn('0'))).to.be.revertedWith(
        'Component: caller is not the owner'
      )
    })
  })

  describe('Do Melt', () => {
    beforeEach(async () => {
      // Approvals for issuance
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      await token0.connect(addr2).approve(rToken.address, initialBal)
      await token1.connect(addr2).approve(rToken.address, initialBal)
      await token2.connect(addr2).approve(rToken.address, initialBal)
      await token3.connect(addr2).approve(rToken.address, initialBal)

      // Issue tokens
      const issueAmount: BigNumber = bn('100e18')
      await rToken.connect(addr1).issue(issueAmount)
      await rToken.connect(addr2).issue(issueAmount)
    })

    it('Should not melt any funds in the initial block', async () => {
      const hndAmt: BigNumber = bn('2e18')

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Melt
      await furnace.connect(addr1).melt()

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Check melt was not processed
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])
    })

    it('Should not melt if no funds available', async () => {
      // Set time period
      const period: number = 60 * 60 * 24 // 1 day
      await furnace.connect(owner).setPeriod(period)

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)

      // Advance to the end to melt full amount
      await advanceTime(period + 1)

      // Melt
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      // Check nothing changed
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should melt 0 for first period, even if funds available', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance one period
      await advanceTime(period + 1)

      // Melt
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      // Another call to melt should also have no impact
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)
    })

    it('Should allow melt - one period', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await advanceTime(period + 1)
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to melt full amount
      await advanceTime(period + 1)

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 1) // 1 period

      // Melt
      await expect(furnace.connect(addr1).melt())
        .to.emit(rToken, 'Melted')
        .withArgs(hndAmt.sub(expAmt))

      // Another call to melt should have no impact
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Should allow melt - two periods, all at once', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await advanceTime(period + 1)
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to melt full amount
      await advanceTime(2 * period + 1)

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 2) // 2 periods

      await expect(furnace.melt()).to.emit(rToken, 'Melted').withArgs(hndAmt.sub(expAmt))

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Should allow melt - two periods, one at a time', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await advanceTime(period + 1)
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to melt full amount
      await advanceTime(period + 1)

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt1 = decayFn(hndAmt, 1) // 1 period

      // Melt
      await expect(furnace.connect(addr1).melt())
        .to.emit(rToken, 'Melted')
        .withArgs(hndAmt.sub(expAmt1))

      // Advance to the end to withdraw full amount
      await advanceTime(period + 1)

      const expAmt2 = decayFn(hndAmt, 2) // 2 periods

      // Melt
      await expect(furnace.connect(addr1).melt())
        .to.emit(rToken, 'Melted')
        .withArgs(bn(expAmt1).sub(expAmt2))

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt2)
    })
  })
})
