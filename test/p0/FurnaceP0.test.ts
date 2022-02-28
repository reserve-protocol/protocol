import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import Big from 'big.js'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  CTokenMock,
  ERC20Mock,
  ExplorerFacadeP0,
  FurnaceP0,
  MainP0,
  RTokenP0,
  StaticATokenMock,
  USDCMock,
} from '../../typechain'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

interface IBatchInfo {
  amount: BigNumber
  start: number
  end: number
  melted: BigNumber
}

const createFixtureLoader = waffle.createFixtureLoader

const makeDecayFn = (ratio: BigNumber) => {
  return (amtRToken: BigNumber, numPeriods: number) => {
    // Use Big.js library for exponential
    const expBase = new Big(fp('1').sub(ratio).toString()).div(new Big('1e18'))
    const result = new Big(amtRToken.toString()).mul(expBase.pow(numPeriods).toString())
    return result.toString()
  }
}

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
  let facade: ExplorerFacadeP0

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

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ basket, rToken, furnace, config, main, facade } = await loadFixture(defaultFixture))

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
      expect(await furnace.rToken()).to.equal(rToken.address)
      expect(await furnace.period()).to.equal(config.rewardPeriod)
      expect(await furnace.owner()).to.equal(owner.address)
    })

    it('Deployment does not accept empty token', async () => {
      await expect(FurnaceFactory.deploy(ZERO_ADDRESS, bn('0'), bn('0'))).to.be.revertedWith(
        'rToken is zero address'
      )
    })
  })

  describe('Configuration / State', () => {
    it('Should allow to update period correctly if Owner', async () => {
      // Setup a new value
      const newRewardPeriod: BigNumber = bn('100000')

      await furnace.connect(owner).setPeriod(newRewardPeriod)

      expect(await furnace.period()).to.equal(newRewardPeriod)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setPeriod(bn('0'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should allow to update ratio correctly if Owner', async () => {
      // Setup a new value
      const newRatio: BigNumber = bn('100000')

      await furnace.connect(owner).setRatio(newRatio)

      expect(await furnace.ratio()).to.equal(newRatio)

      // Try to update again if not owner
      await expect(furnace.connect(addr1).setPeriod(bn('0'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
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
    })

    it('Should not melt any funds in the initial block', async () => {
      const hndAmt: BigNumber = bn('2e18')

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      // Melt
      await furnace.connect(addr1).melt()

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      const latestTimestamp = await getLatestBlockTimestamp()

      // Check melt was registered but not processed
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])
    })

    it('Should allow melt - one period', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setPeriod(period)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to withdraw full amount
      await advanceTime(period + 1)

      // Melt
      await furnace.connect(addr1).melt()

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 1) // 1 period

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Should allow melt - two periods, all at once', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setPeriod(period)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to withdraw full amount
      await advanceTime(2 * period + 1)

      // Melt
      await furnace.connect(addr1).melt()

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 2) // 2 periods

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })

    it('Should allow melt - two periods, one at a time', async () => {
      const hndAmt: BigNumber = bn('10e18')
      const period: number = 60 * 60 * 24 // 1 day

      // Set time period for batches
      await furnace.connect(owner).setPeriod(period)

      // Approval
      await rToken.connect(addr1).transfer(furnace.address, hndAmt)

      const hndTimestamp = await getLatestBlockTimestamp()

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(hndAmt)

      // Advance to the end to withdraw full amount
      await advanceTime(period + 1)

      // Melt
      await furnace.connect(addr1).melt()

      // Advance to the end to withdraw full amount
      await advanceTime(period + 1)

      // Melt
      await furnace.connect(addr1).melt()

      const decayFn = makeDecayFn(await furnace.ratio())
      const expAmt = decayFn(hndAmt, 2) // 2 period

      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.sub(hndAmt))
      expect(await rToken.balanceOf(furnace.address)).to.equal(expAmt)
    })
  })
})
