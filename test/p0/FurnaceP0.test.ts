import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre from 'hardhat'
import { ethers } from 'hardhat'

import { ZERO_ADDRESS } from '../../common/constants'
import { bn } from '../../common/numbers'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { RTokenMockP0 } from '../../typechain/RTokenMockP0'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'

interface IBatchInfo {
  amount: BigNumber
  start: number
  duration: number
  burnt: BigNumber
}

describe('FurnaceP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  let RTokenMockFactory: ContractFactory
  let FurnaceFactory: ContractFactory
  let furnace: FurnaceP0
  let rToken: RTokenMockP0

  let initialBal: BigNumber

  const expectBatchInfo = async (index: number, hdnOutInfo: Partial<IBatchInfo>) => {
    const { amount, start, duration, burnt } = await furnace.batches(index)

    expect(amount).to.equal(hdnOutInfo.amount)
    expect(start).to.equal(hdnOutInfo.start)
    expect(duration).to.equal(hdnOutInfo?.duration)
    expect(burnt).to.equal(hdnOutInfo.burnt)
  }

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy RToken Mock
    RTokenMockFactory = await ethers.getContractFactory('RTokenMockP0')
    rToken = <RTokenMockP0>await RTokenMockFactory.deploy('RToken', 'RTKN')

    // Mint and set balances
    initialBal = bn('100e18')
    await rToken.connect(owner).mint(addr1.address, initialBal)
    await rToken.connect(owner).mint(addr2.address, initialBal)

    // Deploy Furnace
    FurnaceFactory = await ethers.getContractFactory('FurnaceP0')
    furnace = <FurnaceP0>await FurnaceFactory.deploy(rToken.address)
  })

  describe('Deployment', () => {
    it('Deployment should setup Furnace correctly', async () => {
      expect(await furnace.rToken()).to.equal(rToken.address)
    })

    it('Deployment does not accept empty token', async () => {
      await expect(FurnaceFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith('Token is zero address')
    })
  })

  describe('Burn Batches', () => {
    const timePeriod: number = 60 * 60 * 24 // 1 day

    it('Should not allow batches with zero amount', async () => {
      const zero: BigNumber = bn(0)

      await expect(furnace.connect(addr1).burnOverPeriod(zero, timePeriod)).to.be.revertedWith(
        'Cannot burn a batch of zero'
      )
    })

    it('Should revert when not providing approval for tokens', async () => {
      const hndAmt: BigNumber = bn('10e18')

      await expect(furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
    })

    it('Should revert when not having enough RTokens for burn', async () => {
      const hndAmt: BigNumber = bn('20000e18')

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      await expect(furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
    })

    it('Should allow batches correctly', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Check burn registered
      expectBatchInfo(0, {
        amount: hndAmt,
        start: await getLatestBlockTimestamp(),
        duration: timePeriod,
        burnt: bn('0'),
      })
    })

    it('Should allow multiple batches', async () => {
      const hndAmt1: BigNumber = bn('10e18')
      const hndAmt2: BigNumber = bn('50e18')

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt1)
      await rToken.connect(addr2).approve(furnace.address, hndAmt2)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt1, timePeriod)

      // Check burn registered
      expectBatchInfo(0, {
        amount: hndAmt1,
        start: await getLatestBlockTimestamp(),
        duration: timePeriod,
        burnt: bn('0'),
      })

      // Additional Batch burn
      await furnace.connect(addr2).burnOverPeriod(hndAmt2, timePeriod)

      // Check burn registered
      expectBatchInfo(1, {
        amount: hndAmt2,
        start: await getLatestBlockTimestamp(),
        duration: timePeriod,
        burnt: bn('0'),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt1))
      expect(await rToken.balanceOf(addr2.address)).to.equal(initialBal.sub(hndAmt2))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt1.add(hndAmt2))
    })
  })

  describe('Do Burn', () => {
    it('Should allow burn all funds if period is zero', async () => {
      const hndAmt: BigNumber = bn('2e18')

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, 0)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Check burn registered
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: 0,
        burnt: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      expect(await furnace.totalBurnt()).to.equal(hndAmt)
    })

    it('Should allow burn - full amount if period is complete', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)
      expect(await furnace.totalBurnt()).to.equal(0)

      // Advance to the end to withdraw full amount
      await advanceTime(timePeriod + 1)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Check burn registered
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      expect(await furnace.totalBurnt()).to.equal(hndAmt)
    })

    it('Should not return more funds once all was burnt', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      // Advance to the end to withdraw full amount
      await advanceTime(timePeriod + 1)

      // Burn
      await furnace.connect(addr1).doBurn()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      expect(await furnace.totalBurnt()).to.equal(hndAmt)

      // Try to burn again
      await furnace.connect(addr1).doBurn()

      // Check burn not modified
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt,
      })

      // No changes in balances
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      expect(await furnace.totalBurnt()).to.equal(hndAmt)
    })

    it('Should allow burn - two equal parts', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)
      expect(await furnace.totalBurnt()).to.equal(0)

      // Advance to the middle of period
      //await advanceTime(timePeriod / 2 - 1)
      await advanceToTimestamp(hndTimestamp + timePeriod / 2 - 1)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Check burn registered
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt.div(2),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt.div(2))
      expect(await furnace.totalBurnt()).to.equal(hndAmt.div(2))

      // Advance to the end
      //await advanceTime(timePeriod / 2)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + timePeriod / 2)

      // Burn with any account
      await furnace.connect(addr2).doBurn()

      // Check burn registered
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      expect(await furnace.totalBurnt()).to.equal(hndAmt)
    })

    it('Should allow burn - for multiple batches', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      const hndAmt2: BigNumber = bn('20e18')
      const timePeriod2: number = 60 * 60 // 1 hour

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt2)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt2, timePeriod2)

      const hndTimestamp1 = await getLatestBlockTimestamp()

      // Advance to the middle of period
      // await advanceTime(timePeriod / 2 - 3) // already 2 additional blocks processed
      await advanceToTimestamp(hndTimestamp1 + timePeriod / 2 - 3)

      // Burn with any account
      await furnace.connect(addr2).doBurn()

      // Check burn registered in both batches
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt.div(2),
      })

      // Batch burn 2
      expectBatchInfo(1, {
        amount: hndAmt2,
        start: hndTimestamp1,
        duration: timePeriod2,
        burnt: hndAmt2,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt.div(2))
      expect(await furnace.totalBurnt()).to.equal(hndAmt.div(2).add(hndAmt2))

      // Advance to the 75% of largest period
      //await advanceTime(timePeriod / 4 - 1)
      await advanceToTimestamp((await getLatestBlockTimestamp()) + timePeriod / 4 - 1)

      // Burn with any account
      await furnace.connect(addr2).doBurn()

      // Check burn updated in burn
      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt.div(2).add(hndAmt.div(4)),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt.div(4))
      expect(await furnace.totalBurnt()).to.equal(hndAmt2.add(hndAmt.div(2).add(hndAmt.div(4))))

      // Approval
      await rToken.connect(addr2).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr2).burnOverPeriod(hndAmt, timePeriod / 2)

      const hndTimestamp2 = await getLatestBlockTimestamp()

      // Check new burn registered
      expectBatchInfo(2, {
        amount: hndAmt,
        start: hndTimestamp2,
        duration: timePeriod / 2,
        burnt: bn('0'),
      })

      // Advance to the end of largest period, shoeuld process half of the last burn
      // await advanceTime(timePeriod / 4 - 1)
      await advanceToTimestamp(hndTimestamp2 + timePeriod / 4 - 1)

      // Burn with any account
      await furnace.connect(addr2).doBurn()

      // Check burn updated

      expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        burnt: hndAmt,
      })

      expectBatchInfo(2, {
        amount: hndAmt,
        start: hndTimestamp2,
        duration: timePeriod / 2,
        burnt: hndAmt.div(2),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(addr2.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt.div(2))
      expect(await furnace.totalBurnt()).to.equal(hndAmt.add(hndAmt2).add(hndAmt.div(2)))
    })

    it('Should not burn any funds in the initial block', async () => {
      const hndAmt: BigNumber = bn('2e18')

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Approval
      await rToken.connect(addr1).approve(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).burnOverPeriod(hndAmt, 0)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Check burn was registered but not processed
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)
      expect(await furnace.totalBurnt()).to.equal(0)

      expectBatchInfo(0, {
        amount: hndAmt,
        start: await getLatestBlockTimestamp(),
        duration: 0,
        burnt: bn('0'),
      })

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])
    })
  })
})
