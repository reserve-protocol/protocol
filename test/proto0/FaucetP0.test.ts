import { expect } from 'chai'
import { ethers } from 'hardhat'
import hre from 'hardhat'
import { BigNumber, ContractFactory, Contract } from 'ethers'
import { bn } from '../../common/numbers'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { RTokenMockP0 } from '../../typechain/RTokenMockP0'
import { FaucetP0 } from '../../typechain/FaucetP0'
import { ZERO_ADDRESS } from '../../common/constants'

interface IHandoutInfo {
  amount: BigNumber
  start: number
  duration: number
  released: BigNumber
}

describe('FaucetP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let beneficiary: Contract | SignerWithAddress

  let ERC20: ContractFactory
  let FaucetFactory: ContractFactory
  let RToken: ContractFactory
  let faucet: FaucetP0
  let rToken: RTokenMockP0
  let rsr: ERC20Mock

  let initialBal: BigNumber

  const expectHandoutInfo = async (index: number, hdnOutInfo: Partial<IHandoutInfo>) => {
    const { amount, start, duration, released } = await faucet.handouts(index)

    expect(amount).to.equal(hdnOutInfo.amount)
    expect(start).to.equal(hdnOutInfo.start)
    expect(duration).to.equal(hdnOutInfo?.duration)
    expect(released).to.equal(hdnOutInfo.released)
  }

  before(async () => {
    // Reset for correct timestamp disbursement calculation
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, beneficiary] = await ethers.getSigners()

    // Deploy RSR and RToken
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')

    RToken = await ethers.getContractFactory('RTokenMockP0')
    rToken = <RTokenMockP0>await RToken.deploy('RToken', 'RTKN', rsr.address)

    // Mint and set balances
    initialBal = bn(100e18)
    await rToken.connect(owner).mint(addr1.address, initialBal)
    await rToken.connect(owner).mint(addr2.address, initialBal)

    // Deploy Faucet
    FaucetFactory = await ethers.getContractFactory('FaucetP0')
    faucet = <FaucetP0>await FaucetFactory.deploy(beneficiary.address, rToken.address)
  })

  describe('Deployment', () => {
    it('Deployment should setup Faucet correctly', async () => {
      expect(await faucet.beneficiary()).to.equal(beneficiary.address)
      expect(await faucet.token()).to.equal(rToken.address)
    })

    it('Deployment does not accept empty beneficiary and token', async () => {
      await expect(FaucetFactory.deploy(ZERO_ADDRESS, rToken.address)).to.be.revertedWith('Beneficiary is zero address')
      await expect(FaucetFactory.deploy(beneficiary.address, ZERO_ADDRESS)).to.be.revertedWith('Token is zero address')
    })
  })

  describe('Handouts', () => {
    const timePeriod: number = 60 * 60 * 24 // 1 day

    it('Should not allow handouts with zero amount', async () => {
      const zero: BigNumber = bn(0)

      await expect(faucet.connect(addr1).handout(zero, timePeriod)).to.be.revertedWith('Cannot handout zero')
    })

    it('Should revert when not providing approval for tokens', async () => {
      const hndAmt: BigNumber = bn(10e18)

      await expect(faucet.connect(addr1).handout(hndAmt, timePeriod)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
    })

    it('Should revert when not having enough RTokens for handout', async () => {
      const hndAmt: BigNumber = bn(20000e18)

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      await expect(faucet.connect(addr1).handout(hndAmt, timePeriod)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
    })

    it('Should allow handouts correctly', async () => {
      const hndAmt: BigNumber = bn(10e18)

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr1).handout(hndAmt, timePeriod)

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt)

      // Check handout registered
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: await getLatestBlockTimestamp(),
        duration: timePeriod,
        released: bn(0),
      })
    })

    it('Should allow multiple handouts', async () => {
      const hndAmt1: BigNumber = bn(10e18)
      const hndAmt2: BigNumber = bn(50e18)

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt1)
      await rToken.connect(addr2).approve(faucet.address, hndAmt2)

      // Handout
      await faucet.connect(addr1).handout(hndAmt1, timePeriod)

      // Check handout registered
      expectHandoutInfo(0, {
        amount: hndAmt1,
        start: await getLatestBlockTimestamp(),
        duration: timePeriod,
        released: bn(0),
      })

      // Additional Handout
      await faucet.connect(addr2).handout(hndAmt2, timePeriod)

      // Check handout registered
      expectHandoutInfo(1, {
        amount: hndAmt2,
        start: await getLatestBlockTimestamp(),
        duration: timePeriod,
        released: bn(0),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt1))
      expect(await rToken.balanceOf(addr2.address)).to.equal(initialBal.sub(hndAmt2))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt1.add(hndAmt2))
    })
  })

  describe('Drip', () => {
    it('Should allow drips all funds if period is zero', async () => {
      const hndAmt: BigNumber = bn(2e18)

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr1).handout(hndAmt, 0)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(0)

      // Drip
      await faucet.connect(addr1).drip()

      // Check drip registered
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: 0,
        released: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(0)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt)
    })

    it('Should allow drips - full amount if period is complete', async () => {
      const hndAmt: BigNumber = bn(10e18)
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr1).handout(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(0)

      // Advance to the end to withdraw full amount
      advanceTime(timePeriod + 1)

      // Drip
      await faucet.connect(addr1).drip()

      // Check drip registered
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(0)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt)
    })

    it('Should not return more funds once all was released', async () => {
      const hndAmt: BigNumber = bn(10e18)
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr1).handout(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      // Advance to the end to withdraw full amount
      advanceTime(timePeriod + 1)

      // Drip
      await faucet.connect(addr1).drip()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(0)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt)

      // Try to drip again
      await faucet.connect(addr1).drip()

      // Check drip not modified
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt,
      })

      // No changes in balances
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(0)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt)
    })

    it('Should allow drips - two equal parts', async () => {
      const hndAmt: BigNumber = bn(10e18)
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr1).handout(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(0)

      // Advance to the middle of period
      advanceTime(timePeriod / 2 - 1)

      // Drip
      await faucet.connect(addr1).drip()

      // Check drip registered
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt.div(2),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt.div(2))
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt.div(2))

      // Advance to the end
      advanceTime(timePeriod / 2)

      // Drip with any account
      await faucet.connect(addr2).drip()

      // Check drip registered
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(0)
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt)
    })

    it('Should allow drips - for multiple handouts', async () => {
      const hndAmt: BigNumber = bn(10e18)
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr1).handout(hndAmt, timePeriod)

      const hndTimestamp = await getLatestBlockTimestamp()

      const hndAmt2: BigNumber = bn(20e18)
      const timePeriod2: number = 60 * 60 // 1 hour

      // Approval
      await rToken.connect(addr1).approve(faucet.address, hndAmt2)

      // Handout
      await faucet.connect(addr1).handout(hndAmt2, timePeriod2)

      const hndTimestamp1 = await getLatestBlockTimestamp()

      // Advance to the middle of period
      advanceTime(timePeriod / 2 - 3) // already 2 additional blocks processed

      // Drip with any account
      await faucet.connect(addr2).drip()

      // Check drip registered in both handouts
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt.div(2),
      })

      // Handout 2
      expectHandoutInfo(1, {
        amount: hndAmt2,
        start: hndTimestamp1,
        duration: timePeriod2,
        released: hndAmt2,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt.div(2))
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt2.add(hndAmt.div(2)))

      // Advance to the 75% of largest period
      advanceTime(timePeriod / 4 - 1)

      // Drip with any account
      await faucet.connect(addr2).drip()

      // Check drip updated in handout
      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt.div(2).add(hndAmt.div(4)),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt.div(4))
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt2.add(hndAmt.div(2)).add(hndAmt.div(4)))

      // Approval
      await rToken.connect(addr2).approve(faucet.address, hndAmt)

      // Handout
      await faucet.connect(addr2).handout(hndAmt, timePeriod / 2)

      const hndTimestamp2 = await getLatestBlockTimestamp()

      // Check new handout registered
      expectHandoutInfo(2, {
        amount: hndAmt,
        start: hndTimestamp2,
        duration: timePeriod / 2,
        released: bn(0),
      })

      // Advance to the end of largest period, shoeuld process half of the last handout
      advanceTime(timePeriod / 4 - 1)

      // Drip with any account
      await faucet.connect(addr2).drip()

      // Check drip updated

      expectHandoutInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        duration: timePeriod,
        released: hndAmt,
      })

      expectHandoutInfo(2, {
        amount: hndAmt,
        start: hndTimestamp2,
        duration: timePeriod / 2,
        released: hndAmt.div(2),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(addr2.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(faucet.address)).to.equal(hndAmt.div(2))
      expect(await rToken.balanceOf(beneficiary.address)).to.equal(hndAmt2.add(hndAmt).add(hndAmt.div(2)))
    })
  })
})
