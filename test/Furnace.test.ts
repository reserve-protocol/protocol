import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, upgrades, waffle } from 'hardhat'
import { bn, fp } from '../common/numbers'
import { whileImpersonating } from './utils/impersonation'
import {
  CTokenMock,
  ERC20Mock,
  StaticATokenMock,
  TestIBackingManager,
  TestIFurnace,
  TestIMain,
  TestIRToken,
  USDCMock,
} from '../typechain'
import { advanceTime } from './utils/time'
import { Collateral, defaultFixture, IConfig, Implementation, IMPLEMENTATION } from './fixtures'
import { makeDecayFn } from './utils/rewards'
import snapshotGasCost from './utils/snapshotGasCost'
import { cartesianProduct } from './utils/cases'

const createFixtureLoader = waffle.createFixtureLoader

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

describe(`FurnaceP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Contracts
  let main: TestIMain
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let backingManager: TestIBackingManager
  let basket: Collateral[]

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

  // Implementation-agnostic interface for deploying the Furnace
  const deployNewFurnace = async (): Promise<TestIFurnace> => {
    if (IMPLEMENTATION == Implementation.P0) {
      const FurnaceFactory: ContractFactory = await ethers.getContractFactory('FurnaceP0')
      return <TestIFurnace>await FurnaceFactory.deploy()
    } else if (IMPLEMENTATION == Implementation.P1) {
      const FurnaceFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
      return <TestIFurnace>await upgrades.deployProxy(FurnaceFactory, [], {
        kind: 'uups',
      })
    } else {
      throw new Error('PROTO_IMPL must be set to either `0` or `1`')
    }
  }

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({ main, basket, rToken, furnace, config } = await loadFixture(defaultFixture))

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
  })

  describe('Deployment #fast', () => {
    it('Deployment should setup Furnace correctly', async () => {
      expect(await furnace.period()).to.equal(config.rewardPeriod)
      expect(await furnace.ratio()).to.equal(config.rewardRatio)
      expect(await furnace.lastPayout()).to.be.gt(0) // A timestamp is set
      expect(await furnace.main()).to.equal(main.address)
    })

    it('Deployment does not accept empty period', async () => {
      const newConfig = JSON.parse(JSON.stringify(config))
      newConfig.rewardPeriod = bn('0')
      const newFurnace: TestIFurnace = <TestIFurnace>await deployNewFurnace()
      await expect(
        newFurnace.init(main.address, newConfig.rewardPeriod, newConfig.rewardRatio)
      ).to.be.revertedWith('period cannot be zero')
    })
  })

  describe('Configuration / State #fast', () => {
    it('Should allow to update period correctly if Owner and perform validations', async () => {
      // Setup a new value
      const newRewardPeriod: BigNumber = bn('100000')

      await expect(furnace.connect(owner).setPeriod(newRewardPeriod))
        .to.emit(furnace, 'PeriodSet')
        .withArgs(config.rewardPeriod, newRewardPeriod)

      expect(await furnace.period()).to.equal(newRewardPeriod)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setPeriod(bn('500'))).to.be.revertedWith(
        'governance only'
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
      await expect(furnace.connect(addr1).setRatio(bn('0'))).to.be.revertedWith('governance only')
    })
  })

  describe('Do Melt #fast', () => {
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

  describe('Extreme Bounds', () => {
    const applyParameters = async (
      period: BigNumber,
      ratio: BigNumber,
      bal: BigNumber
    ): Promise<TestIFurnace> => {
      // Deploy fixture
      ;({ main, rToken, backingManager } = await loadFixture(defaultFixture))

      const newConfig = JSON.parse(JSON.stringify(config))
      newConfig.rewardPeriod = period
      newConfig.rewardRatio = ratio
      const newFurnace: TestIFurnace = <TestIFurnace>await deployNewFurnace()

      await main.connect(owner).setFurnace(newFurnace.address)

      // Issue and send tokens to furnace
      if (bal.gt(bn('0'))) {
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await rToken.connect(bmSigner).mint(newFurnace.address, bal)
        })
      }
      await newFurnace.init(main.address, newConfig.rewardPeriod, newConfig.rewardRatio)

      return newFurnace
    }

    it('Should not revert at extremes', async () => {
      // max: // 2^32 - 1
      const periods = [bn('4294967295'), bn('1'), bn('604800')]

      const ratios = [fp('1'), fp('0'), fp('0.02284')]

      const bals = [fp('1e18'), fp('0'), bn('1e9')]

      const cases = cartesianProduct(periods, ratios, bals)
      for (let i = 0; i < cases.length; i++) {
        const args: BigNumber[] = cases[i]
        const period = args[0]
        const ratio = args[1]
        const bal = args[2]

        const newFurnace: TestIFurnace = <TestIFurnace>await applyParameters(period, ratio, bal)

        // Should melt after 1 period
        await advanceTime(period.add(1).toString())
        await newFurnace.melt()

        // Should melt after 1000 periods
        await advanceTime(period.mul(1000).add(1).toString())
        await newFurnace.melt()
      }
    })
  })

  describeGas('Gas Reporting', () => {
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

    it('Melt - One period ', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Call with no impact
      await snapshotGasCost(furnace.connect(addr1).melt())

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await advanceTime(period + 1)
      await snapshotGasCost(furnace.connect(addr1).melt())

      // Advance to the end to melt full amount
      await advanceTime(period + 1)

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 1) // 1 period

      // Melt
      await snapshotGasCost(furnace.connect(addr1).melt())

      // Another call to melt with no impact
      await snapshotGasCost(furnace.connect(addr1).melt())

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Melt - Many periods, all at once', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await advanceTime(period + 1)
      await snapshotGasCost(furnace.connect(addr1).melt())
      // Advance to the end to melt full amount
      await advanceTime(10 * period + 1)

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 10) // 10 periods

      await snapshotGasCost(furnace.connect(addr1).melt())

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(expAmt, 15)
    })

    it('Melt - Many periods, one after the other', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period
      await furnace.connect(owner).setPeriod(period)

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await advanceTime(period + 1)
      await snapshotGasCost(furnace.connect(addr1).melt())

      // Melt 10 periods
      for (let i = 1; i <= 10; i++) {
        await advanceTime(period + 1)
        await snapshotGasCost(furnace.connect(addr1).melt())
      }

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 10) // 10 periods

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(expAmt, 15)
    })
  })
})
