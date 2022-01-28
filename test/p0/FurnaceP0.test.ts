import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre from 'hardhat'
import { ethers, waffle } from 'hardhat'

import { ZERO_ADDRESS } from '../../common/constants'
import { bn } from '../../common/numbers'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

interface IBatchInfo {
  amount: BigNumber
  start: number
  burnt: BigNumber
}

const createFixtureLoader = waffle.createFixtureLoader

describe('FurnaceP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  let FurnaceFactory: ContractFactory
  let furnace: FurnaceP0
  let main: MainP0
  let rToken: RTokenP0
  let basket: Collateral[]

  // Config values
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

  const expectBatchInfo = async (index: number, hdnOutInfo: Partial<IBatchInfo>) => {
    const { amount, start, burnt } = await furnace.batches(index)

    expect(amount).to.equal(hdnOutInfo.amount)
    expect(start).to.equal(hdnOutInfo.start)
    expect(burnt).to.equal(hdnOutInfo.burnt)
  }

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ basket, rToken, furnace, config, main } = await loadFixture(defaultFixture))

    // Setup issuance of RTokens for users
    initialBal = bn('100e18')

    // Get assets and tokens
    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = basket[2]
    collateral3 = basket[3]

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
      expect(await furnace.rToken()).to.equal(rToken.address)
      expect(await furnace.batchDuration()).to.equal(config.rewardPeriod)
      expect(await furnace.owner()).to.equal(owner.address)
    })

    it('Deployment does not accept empty token', async () => {
      await expect(FurnaceFactory.deploy(ZERO_ADDRESS, bn('0'))).to.be.revertedWith(
        'Token is zero address'
      )
    })
  })

  describe('Configuration / State', () => {
    it('Should allow to update batchDuration correctly if Owner', async () => {
      // Setup a new value
      const newRewardPeriod: BigNumber = bn('100000')

      await furnace.connect(owner).setBatchDuration(newRewardPeriod)

      expect(await furnace.batchDuration()).to.equal(newRewardPeriod)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setBatchDuration(bn('0'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should only allow notifications of deposits for RToken', async () => {
      await expect(furnace.connect(addr1).notifyOfDeposit(other.address)).to.be.revertedWith(
        'RToken only'
      )
    })
  })

  describe('Melting Batches', () => {
    const timePeriod: number = 60 * 60 * 24 // 1 day

    beforeEach(async () => {
      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(timePeriod)

      // Approvals for issuance
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      await token0.connect(addr2).approve(main.address, initialBal)
      await token1.connect(addr2).approve(main.address, initialBal)
      await token2.connect(addr2).approve(main.address, initialBal)
      await token3.connect(addr2).approve(main.address, initialBal)

      // Issue tokens
      const issueAmount: BigNumber = bn('100e18')
      await main.connect(addr1).issue(issueAmount)
      await main.connect(addr2).issue(issueAmount)

      // Process issuance
      await main.poke()
    })

    it('Should allow batches correctly', async () => {
      const hndAmt: BigNumber = bn('10e18')

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Check burn registered
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: await getLatestBlockTimestamp(),
        burnt: bn('0'),
      })
    })

    it('Should allow multiple batches', async () => {
      const hndAmt1: BigNumber = bn('10e18')
      const hndAmt2: BigNumber = bn('50e18')

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt1)
      await rToken.connect(addr2).transfer(furnace.address, hndAmt2)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      // Check burn registered
      await expectBatchInfo(0, {
        amount: hndAmt1.add(hndAmt2),
        start: await getLatestBlockTimestamp(),
        burnt: bn('0'),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt1))
      expect(await rToken.balanceOf(addr2.address)).to.equal(initialBal.sub(hndAmt2))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt1.add(hndAmt2))

      // Another batch
      await rToken.connect(addr1).transfer(furnace.address, hndAmt1)
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      // Check burn registered
      await expectBatchInfo(1, {
        amount: hndAmt1,
        start: await getLatestBlockTimestamp(),
        burnt: bn('0'),
      })
    })
  })

  describe('Do Melt', () => {
    beforeEach(async () => {
      // Approvals for issuance
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      await token0.connect(addr2).approve(main.address, initialBal)
      await token1.connect(addr2).approve(main.address, initialBal)
      await token2.connect(addr2).approve(main.address, initialBal)
      await token3.connect(addr2).approve(main.address, initialBal)

      // Issue tokens
      const issueAmount: BigNumber = bn('100e18')
      await main.connect(addr1).issue(issueAmount)
      await main.connect(addr2).issue(issueAmount)

      // Process issuance
      await main.poke()
    })

    it('Should allow burn all funds if period is zero', async () => {
      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(0)

      const hndAmt: BigNumber = bn('2e18')

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Check burn registered
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        burnt: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should allow burn - full amount if period is complete', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(timePeriod)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to withdraw full amount
      await advanceTime(timePeriod + 1)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Check burn registered
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        burnt: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should not return more funds once all was burnt', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(timePeriod)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      const hndTimestamp = await getLatestBlockTimestamp()

      // Advance to the end to withdraw full amount
      await advanceTime(timePeriod + 1)

      // Burn
      await furnace.connect(addr1).doBurn()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)

      // Try to burn again
      await furnace.connect(addr1).doBurn()

      // Check burn not modified
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        burnt: hndAmt,
      })

      // No changes in balances
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should allow burn - two equal parts', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(timePeriod)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the middle of period
      await advanceToTimestamp(hndTimestamp + timePeriod / 2 - 1)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Check burn registered
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        burnt: hndAmt.div(2),
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt.div(2))

      // Advance to the end
      await advanceToTimestamp((await getLatestBlockTimestamp()) + timePeriod / 2)

      // Burn with any account
      await furnace.connect(addr2).doBurn()

      // Check burn registered
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        burnt: hndAmt,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should allow burn - for multiple batches', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const timePeriod: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(timePeriod)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      const hndTimestamp = await getLatestBlockTimestamp()

      const hndAmt2: BigNumber = bn('20e18')

      // Set time period for batches
      await furnace.connect(owner).setBatchDuration(timePeriod)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt2)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      const hndTimestamp1 = await getLatestBlockTimestamp()

      // Advance to the end of period
      // Both will be processed at this point
      await advanceToTimestamp(hndTimestamp1 + timePeriod + 100)

      // Burn with any account
      await furnace.connect(addr2).doBurn()

      // Check burn registered in both batches
      await expectBatchInfo(0, {
        amount: hndAmt,
        start: hndTimestamp,
        burnt: hndAmt,
      })

      // Batch burn 2
      await expectBatchInfo(1, {
        amount: hndAmt2,
        start: hndTimestamp1,
        burnt: hndAmt2,
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(furnace.address)).to.equal(0)
    })

    it('Should not burn any funds in the initial block', async () => {
      const hndAmt: BigNumber = bn('2e18')

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Batch burn
      await furnace.connect(addr1).notifyOfDeposit(rToken.address)

      // Burn
      await furnace.connect(addr1).doBurn()

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Check burn was registered but not processed
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      await expectBatchInfo(0, {
        amount: hndAmt,
        start: await getLatestBlockTimestamp(),
        burnt: bn('0'),
      })

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])
    })
  })
})
