import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers, upgrades } from 'hardhat'
import { IConfig, MAX_RATIO } from '../common/configuration'
import { bn, fp } from '../common/numbers'
import {
  CTokenMock,
  ERC20Mock,
  StaticATokenMock,
  TestIFurnace,
  TestIMain,
  TestIRToken,
  USDCMock,
} from '../typechain'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from './utils/time'
import { Collateral, defaultFixture, Implementation, IMPLEMENTATION } from './fixtures'
import { makeDecayFn } from './utils/rewards'
import snapshotGasCost from './utils/snapshotGasCost'
import { cartesianProduct } from './utils/cases'
import { ONE_PERIOD, ZERO_ADDRESS } from '../common/constants'
import { useEnv } from '#/utils/env'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

const describeExtreme =
  IMPLEMENTATION == Implementation.P1 && useEnv('EXTREME') ? describe.only : describe

describe(`FurnaceP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Contracts
  let main: TestIMain
  let furnace: TestIFurnace
  let rToken: TestIRToken
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

  // Implementation-agnostic interface for deploying the Furnace
  const deployNewFurnace = async (): Promise<TestIFurnace> => {
    // Deploy fixture
    ;({ furnace } = await loadFixture(defaultFixture))
    return furnace
  }

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
      expect(await furnace.ratio()).to.equal(config.rewardRatio)
      expect(await furnace.lastPayout()).to.be.gt(0) // A timestamp is set
      expect(await furnace.main()).to.equal(main.address)
    })

    // Applies to all components - used here as an example
    it('Deployment does not accept invalid main address', async () => {
      let FurnaceFactory: ContractFactory
      if (IMPLEMENTATION == Implementation.P0) {
        FurnaceFactory = await ethers.getContractFactory('FurnaceP0')
        return <TestIFurnace>await FurnaceFactory.deploy()
      } else if (IMPLEMENTATION == Implementation.P1) {
        FurnaceFactory = await ethers.getContractFactory('FurnaceP1')
        return <TestIFurnace>await upgrades.deployProxy(FurnaceFactory, [], {
          kind: 'uups',
        })
      } else {
        throw new Error('PROTO_IMPL must be set to either `0` or `1`')
      }
      const newFurnace = await FurnaceFactory.deploy()
      await expect(newFurnace.init(ZERO_ADDRESS, config.rewardRatio)).to.be.revertedWith(
        'main is zero address'
      )
    })
  })

  describe('Configuration / State #fast', () => {
    it('Should allow to update ratio correctly if Owner and perform validations', async () => {
      // Setup a new value
      const newRatio: BigNumber = bn('100000')

      await expect(furnace.connect(owner).setRatio(newRatio))
        .to.emit(furnace, 'RatioSet')
        .withArgs(config.rewardRatio, newRatio)

      expect(await furnace.ratio()).to.equal(newRatio)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setRatio(bn('0'))).to.be.revertedWith('governance only')

      // Cannot update with ratio > max
      await expect(furnace.connect(owner).setRatio(MAX_RATIO.add(1))).to.be.revertedWith(
        'invalid ratio'
      )
    })

    it('Should allow to update ratio correctly if frozen', async () => {
      // Setup a new value
      const newRatio: BigNumber = bn('100000')

      await main.freezeShort()

      await expect(furnace.connect(owner).setRatio(newRatio))
        .to.emit(furnace, 'RatioSet')
        .withArgs(config.rewardRatio, newRatio)

      expect(await furnace.ratio()).to.equal(newRatio)
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

    it('Should not melt if paused #fast', async () => {
      await main.connect(owner).pause()
      await expect(furnace.connect(addr1).melt()).to.be.revertedWith('paused or frozen')
    })

    it('Should not melt if frozen #fast', async () => {
      await main.connect(owner).freezeShort()
      await expect(furnace.connect(addr1).melt()).to.be.revertedWith('paused or frozen')
    })

    it('Should not melt any funds in the initial block #fast', async () => {
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

    it('Should not melt if no funds available #fast', async () => {
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)

      // Advance to the end to melt full amount
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      // Melt
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      // Check nothing changed
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should melt 0 for first period, even if funds available #fast', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance one period
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      // Melt
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      // Another call to melt should also have no impact
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)
    })

    it('Should allow melt - one period #fast', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to melt full amount
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

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

    it('Should accumulate negligible error - parallel furnaces', async () => {
      // Maintain two furnaces in parallel, one burning every block and one burning annually
      // We have to use two brand new instances here to ensure their timestamps are synced
      const firstFurnace = await deployNewFurnace()
      const secondFurnace = await deployNewFurnace()

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Populate balances
      const hndAmt: BigNumber = bn('1e18')
      await rToken.connect(addr1).transfer(firstFurnace.address, hndAmt)
      await rToken.connect(addr1).transfer(secondFurnace.address, hndAmt)
      await firstFurnace.init(main.address, config.rewardRatio)
      await secondFurnace.init(main.address, config.rewardRatio)
      await advanceBlocks(1)

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      const oneDay = bn('86400')
      for (let i = 0; i < Number(oneDay.div(ONE_PERIOD)); i++) {
        // Advance a period
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))
        await firstFurnace.melt()
        // secondFurnace does not melt
      }

      // SecondFurnace melts once
      await secondFurnace.melt()

      const one = await rToken.balanceOf(firstFurnace.address)
      const two = await rToken.balanceOf(secondFurnace.address)
      const diff = one.sub(two).abs() // {qRTok}
      const expectedDiff = bn(3555) // empirical exact diff
      // At a rate of 3555 qRToken per day error, a year's worth of error would result in
      // a difference only starting in the 12th decimal place: .000000000001
      // This seems more than acceptable

      expect(diff).to.be.lte(expectedDiff)
    })

    it('Should accumulate negligible error - a year all at once', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      const periods = 2628000 // one year worth

      // Advance a year's worth of periods
      await setNextBlockTimestamp(
        Number(await getLatestBlockTimestamp()) + periods * Number(ONE_PERIOD)
      )

      // Precise JS calculation should be within 3 atto
      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, periods)
      const error = bn('3')
      await expect(furnace.melt()).to.emit(rToken, 'Melted').withArgs(hndAmt.sub(expAmt).add(error))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt.sub(error))
    })

    it('Should allow melt - two periods, one at a time #fast', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to melt full amount
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt1 = decayFn(hndAmt, 1) // 1 period

      // Melt
      await expect(furnace.connect(addr1).melt())
        .to.emit(rToken, 'Melted')
        .withArgs(hndAmt.sub(expAmt1))

      // Advance to the end to withdraw full amount
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      const expAmt2 = decayFn(hndAmt, 2) // 2 periods

      // Melt
      await expect(furnace.connect(addr1).melt())
        .to.emit(rToken, 'Melted')
        .withArgs(bn(expAmt1).sub(expAmt2))

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt2)
    })

    it('Should melt before updating the ratio #fast', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to melt full amount
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 1) // 1 period

      // Melt
      await expect(furnace.setRatio(bn('1e17')))
        .to.emit(rToken, 'Melted')
        .withArgs(hndAmt.sub(expAmt))

      // Another call to melt should have no impact
      await expect(furnace.connect(addr1).melt()).to.not.emit(rToken, 'Melted')

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })
  })

  describeExtreme('Extreme Bounds', () => {
    const applyParameters = async (ratio: BigNumber, bal: BigNumber): Promise<TestIFurnace> => {
      // Deploy fixture
      ;({ main, rToken, furnace } = await loadFixture(defaultFixture))

      await furnace.connect(owner).setRatio(ratio)

      const max256 = bn(2).pow(256).sub(1)
      await token0.connect(owner).mint(addr1.address, max256)
      await token1.connect(owner).mint(addr1.address, max256)
      await token2.connect(owner).mint(addr1.address, max256)
      await token3.connect(owner).mint(addr1.address, max256)
      await token0.connect(addr1).approve(rToken.address, max256)
      await token1.connect(addr1).approve(rToken.address, max256)
      await token2.connect(addr1).approve(rToken.address, max256)
      await token3.connect(addr1).approve(rToken.address, max256)

      // Set up larger throttles
      const throttle = { amtRate: bal.lt(fp('1')) ? fp('1') : bal, pctRate: 0 }
      await rToken.connect(owner).setIssuanceThrottleParams(throttle)
      await rToken.connect(owner).setRedemptionThrottleParams(throttle)
      await advanceTime(3600)

      // Issue and send tokens to furnace
      if (bal.gt(bn('0'))) {
        await rToken.connect(addr1).issue(bal)
      }

      // Charge throttles
      await advanceTime(3600)

      return furnace
    }

    it('Should not revert at extremes', async () => {
      const ratios = [fp('1'), fp('0'), fp('0.000001069671574938')]

      const bals = [fp('1e18'), fp('0'), bn('1e9')]

      const cases = cartesianProduct(ratios, bals)
      for (let i = 0; i < cases.length; i++) {
        const args: BigNumber[] = cases[i]
        const ratio = args[0]
        const bal = args[1]

        const newFurnace: TestIFurnace = <TestIFurnace>await applyParameters(ratio, bal)

        // Should melt after 1 period
        await setNextBlockTimestamp(
          Number(await getLatestBlockTimestamp()) + 10 * Number(ONE_PERIOD)
        )
        await newFurnace.melt()

        // Should melt after 1000 periods
        await setNextBlockTimestamp(
          Number(await getLatestBlockTimestamp()) + 1000 * Number(ONE_PERIOD)
        )
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

      // Advance blocks to fill battery
      await advanceBlocks(300)
    })

    it('Melt - One period ', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Call with no impact
      await snapshotGasCost(furnace.connect(addr1).melt())

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      await snapshotGasCost(furnace.connect(addr1).melt())

      // Advance to the end to melt full amount
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 1) // 1 period

      // Melt
      await snapshotGasCost(furnace.connect(addr1).melt())

      // Another call to melt with no impact
      await snapshotGasCost(furnace.connect(addr1).melt())

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Melt - A million periods, all at once', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const numPeriods = bn('1e6')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      await snapshotGasCost(furnace.connect(addr1).melt())
      // Advance to the end to melt full amount
      await setNextBlockTimestamp(
        Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD.mul(numPeriods))
      )

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, Number(numPeriods)) // 10 periods

      await snapshotGasCost(furnace.connect(addr1).melt())

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(expAmt, 15)
    })

    it('Melt - Many periods, one after the other', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Transfer
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Get past first noop melt
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

      await snapshotGasCost(furnace.connect(addr1).melt())

      // Melt 10 periods
      for (let i = 1; i <= 10; i++) {
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))

        await snapshotGasCost(furnace.connect(addr1).melt())
      }

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 10) // 10 periods

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(expAmt, 15)
    })
  })
})
