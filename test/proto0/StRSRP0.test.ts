import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory } from 'ethers'
import { bn, fp } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainMockP0 } from '../../typechain/MainMockP0'
import { ManagerInternalMockP0 } from '../../typechain/ManagerInternalMockP0'
import { StRSRP0 } from '../../typechain/StRSRP0'

describe('StRSRP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress
  let other: SignerWithAddress

  // RSR
  let ERC20: ContractFactory
  let rsr: ERC20Mock

  // Main and AssetManager mocks
  let MainMockFactory: ContractFactory
  let main: MainMockP0
  let assetManager: ManagerInternalMockP0

  // StRSR
  let StRSRFactory: ContractFactory
  let stRSR: StRSRP0

  // Config values
  let stRSRWithdrawalDelay: BigNumber

  // Quantities
  let initialBal: BigNumber

  beforeEach(async () => {
    ;[owner, addr1, addr2, addr3, other] = await ethers.getSigners()

    // Deploy RSR, WETH, AAVE, and COMP tokens
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')
    
    // Deploy Main Mock
    MainMockFactory = await ethers.getContractFactory('MainMockP0')
    stRSRWithdrawalDelay = bn(0)
    main = <MainMockP0>await MainMockFactory.deploy(rsr.address, other.address, other.address, other.address, stRSRWithdrawalDelay, fp('0'))

    // Mint initial amounts
    initialBal = bn('100e18')
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(owner).mint(addr2.address, initialBal)
    await rsr.connect(owner).mint(addr3.address, initialBal)
    await rsr.connect(owner).mint(owner.address, initialBal)

    // Deploy StRSR_Sys0
    StRSRFactory = await ethers.getContractFactory('StRSRP0')
    stRSR = <StRSRP0>await StRSRFactory.connect(owner).deploy(main.address, 'Staked RSR - RToken', 'stRTKNRSR')

    // Set Main
    await main.connect(owner).setStRSR(stRSR.address)

    // Get Asset Manager (needs to be the caller for seize RSR)
    assetManager = <ManagerInternalMockP0>await ethers.getContractAt('ManagerInternalMockP0', await main.manager())
  })

  describe('Deployment', () => {
    it('Deployment should setup initial addresses and values correctly', async () => {
      expect(await stRSR.main()).to.equal(main.address)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await stRSR.balanceOf(owner.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

      // ERC20
      expect(await stRSR.name()).to.equal('Staked RSR - RToken')
      expect(await stRSR.symbol()).to.equal('stRTKNRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)
    })
  })

  describe('Deposits/Staking', () => {
    it('Should allow to stake/deposit in RSR', async () => {
      // Perform stake
      const amount: BigNumber = bn('1e18')

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
    })

    it('Should not allow to stake amount = 0', async () => {
      // Perform stake
      const amount: BigNumber = bn('1e18')
      const zero: BigNumber = bn(0)

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await expect(stRSR.connect(addr1).stake(zero)).to.be.revertedWith('Cannot stake zero')

      // Check deposit not registered
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should allow multiple stakes/deposits in RSR', async () => {
      // Perform stake
      const amount1: BigNumber = bn('1e18')
      const amount2: BigNumber = bn('2e18')
      const amount3: BigNumber = bn('3e18')

      // Approve transfer and stake twice
      await rsr.connect(addr1).approve(stRSR.address, amount1.add(amount2))
      await stRSR.connect(addr1).stake(amount1)
      await stRSR.connect(addr1).stake(amount2)

      // New stake from different account
      await rsr.connect(addr2).approve(stRSR.address, amount3)
      await stRSR.connect(addr2).stake(amount3)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount1.add(amount2).add(amount3))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1).sub(amount2))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount1.add(amount2))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount3))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount3)
    })
  })

  describe('Withdrawals/Unstaking', () => {
    it('Should create Pending withdrawal when unstaking', async () => {
      const amount: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Check withdrawal properly registered
      const [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should not allow to unstake amount = 0', async () => {
      const zero: BigNumber = bn(0)

      // Unstake
      await expect(stRSR.connect(addr1).unstake(zero)).to.be.revertedWith('Cannot withdraw zero')
    })

    it('Should not allow to unstake if not enough balance', async () => {
      const amount: BigNumber = bn('1e18')

      // Unstake with no stakes/balance
      await expect(stRSR.connect(addr1).unstake(amount)).to.be.revertedWith('Not enough balance')
    })

    it('Should allow multiple unstakes/withdrawals in RSR', async () => {
      // Perform stake
      const amount1: BigNumber = bn('1e18')
      const amount2: BigNumber = bn('2e18')
      const amount3: BigNumber = bn('3e18')

      // Approve transfers
      await rsr.connect(addr1).approve(stRSR.address, amount1.add(amount2))
      await rsr.connect(addr2).approve(stRSR.address, amount3)

      // Stake
      await stRSR.connect(addr1).stake(amount1)
      await stRSR.connect(addr1).stake(amount2)
      await stRSR.connect(addr2).stake(amount3)

      // Unstake - Create withdrawal
      await stRSR.connect(addr1).unstake(amount1)
      let [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount1)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount2)

      // Unstake again
      await stRSR.connect(addr1).unstake(amount2)
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(1)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount2)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      // Unstake again with different user (will process previous stake)
      await stRSR.connect(addr2).unstake(amount3)
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(2)
      expect(unstakeAcc).to.equal(addr2.address)
      expect(unstakeAmt).to.equal(amount3)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)
    })

    context('With deposits and withdrawals', async () => {
      let amount1: BigNumber
      let amount2: BigNumber
      let amount3: BigNumber
      const stkWithdrawalDelay = 20000

      beforeEach(async () => {
        // Set stakingWithdrawalDelay

        await main.connect(owner).setStRSRWithdrawalDelay(stkWithdrawalDelay)

        // Perform stake
        amount1 = bn('1e18')
        amount2 = bn('2e18')
        amount3 = bn('3e18')

        // Approve transfers
        await rsr.connect(addr1).approve(stRSR.address, amount1)
        await rsr.connect(addr2).approve(stRSR.address, amount2.add(amount3))

        // Stake
        await stRSR.connect(addr1).stake(amount1)
        await stRSR.connect(addr2).stake(amount2)
        await stRSR.connect(addr2).stake(amount3)

        // Unstake - Create withdrawal
        await stRSR.connect(addr1).unstake(amount1)
      })

      it('Should not process withdrawals if Main is paused', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Pause Main
        await main.connect(owner).pause()

        // Process unstakes
        await stRSR.processWithdrawals()

        // Nothing processed so far
        expect(await stRSR.withdrawalIndex()).to.equal(0)
        expect(await stRSR.totalSupply()).to.equal(amount1.add(amount2).add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // If unpaused should process OK
        await main.connect(owner).unpause()

        // Process unstakes
        await stRSR.processWithdrawals()

        // Withdrawal was processed
        expect(await stRSR.withdrawalIndex()).to.equal(1)
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not process withdrawals if Manager is not fully capitalized', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Set not fully capitalized
        await assetManager.setFullyCapitalized(false)

        // Process unstakes
        await stRSR.processWithdrawals()

        // Nothing processed so far
        expect(await stRSR.withdrawalIndex()).to.equal(0)
        expect(await stRSR.totalSupply()).to.equal(amount1.add(amount2).add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // If fully capitalized should process OK
        await assetManager.setFullyCapitalized(true)

        // Process unstakes
        await stRSR.processWithdrawals()

        // Withdrawal was processed
        expect(await stRSR.withdrawalIndex()).to.equal(1)
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not process withdrawals before stakingWithdrawalDelay', async () => {
        // Process unstakes
        await stRSR.processWithdrawals()

        // Nothing processed so far
        expect(await stRSR.withdrawalIndex()).to.equal(0)
        expect(await stRSR.totalSupply()).to.equal(amount1.add(amount2).add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // Process unstakes after certain time (still before stakingWithdrawalDelay)
        await advanceTime(15000)

        await stRSR.processWithdrawals()

        // Nothing processed still
        expect(await stRSR.withdrawalIndex()).to.equal(0)
        expect(await stRSR.totalSupply()).to.equal(amount1.add(amount2).add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should process withdrawals after stakingWithdrawalDelay', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Process unstakes
        await stRSR.processWithdrawals()

        // Withdrawal was processed
        expect(await stRSR.withdrawalIndex()).to.equal(1)
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should store weights and calculate balance correctly', async () => {
        // Get current balances for users
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)
        const prevAddr2Balance = await rsr.balanceOf(addr2.address)

        // Create additional withdrawal - Will process previous one
        await stRSR.connect(addr2).unstake(amount2)

        // Move forward past stakingWithdrawalDelaylay
        await advanceTime(stkWithdrawalDelay + 1)

        // Process unstakes
        await stRSR.processWithdrawals()

        // Withdrawals were processed
        expect(await stRSR.withdrawalIndex()).to.equal(2)
        expect(await stRSR.totalSupply()).to.equal(amount3)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
        expect(await rsr.balanceOf(addr2.address)).to.equal(prevAddr2Balance.add(amount2))
        expect(await stRSR.balanceOf(addr2.address)).to.equal(amount3)

        // Create additional withdrawal
        await stRSR.connect(addr2).unstake(amount3)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Process unstakes
        await stRSR.processWithdrawals()

        // Withdrawals processed
        expect(await stRSR.withdrawalIndex()).to.equal(3)
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
        expect(await rsr.balanceOf(addr2.address)).to.equal(prevAddr2Balance.add(amount2).add(amount3))
        expect(await stRSR.balanceOf(addr2.address)).to.equal(0)
      })
    })
  })

  describe('Add/Remove RSR', () => {
    it('Should not allow to remove RSR if caller is not AssetManager', async () => {
      const amount: BigNumber = bn('1e18')
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)

      await expect(stRSR.connect(other).seizeRSR(amount)).to.be.revertedWith('Caller is not Asset Manager')
      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)
    })

    it('Should not allow to add/remove RSR if amount is zero', async () => {
      const zero: BigNumber = bn(0)
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)

      await expect(stRSR.connect(owner).addRSR(zero)).to.be.revertedWith('Amount cannot be zero')
      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)

      await expect(assetManager.connect(owner).seizeRSR(zero)).to.be.revertedWith('Amount cannot be zero')
      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)
    })

    it('Should allow to add RSR - Single staker', async () => {
      const amount: BigNumber = bn('1e18')
      const amount2: BigNumber = bn('10e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Add RSR
      await rsr.connect(owner).approve(stRSR.address, amount2)
      await stRSR.connect(owner).addRSR(amount2)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.add(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.add(amount2))
    })

    it('Should allow to add RSR - Two stakers - Rounded values', async () => {
      const amount: BigNumber = bn('1e18')
      const amount2: BigNumber = bn('10e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Add RSR
      await rsr.connect(owner).approve(stRSR.address, amount2)
      await stRSR.connect(owner).addRSR(amount2)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2).add(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.add(amount2.div(2)))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount.add(amount2.div(2)))
    })

    it('Should allow to add RSR - Three stakers - Check Precision', async () => {
      const amount: BigNumber = bn('1e18')
      const amount2: BigNumber = bn('10e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      await rsr.connect(addr3).approve(stRSR.address, amount)
      await stRSR.connect(addr3).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(3))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr3.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr3.address)).to.equal(amount)

      // Add RSR
      await rsr.connect(owner).approve(stRSR.address, amount2)
      await stRSR.connect(owner).addRSR(amount2)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(3).add(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr3.address)).to.equal(initialBal.sub(amount))

      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.add(amount2.div(3)))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount.add(amount2.div(3)))
      expect(await stRSR.balanceOf(addr3.address)).to.equal(amount.add(amount2.div(3)))
    })

    it('Should allow to remove RSR - Single staker', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Seize RSR
      await assetManager.connect(owner).seizeRSR(amount2)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.sub(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(amount2))
    })

    it('Should allow to remove RSR - Two stakers - Rounded values', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Seize RSR
      await assetManager.connect(owner).seizeRSR(amount2)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2).sub(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(amount2.div(2)))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount.sub(amount2.div(2)))
    })

    it('Should allow to remove RSR - Three stakers - Check Precision', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      await rsr.connect(addr3).approve(stRSR.address, amount)
      await stRSR.connect(addr3).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(3))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr3.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr3.address)).to.equal(amount)

      // Add RSR
      await assetManager.connect(owner).seizeRSR(amount2)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(3).sub(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr3.address)).to.equal(initialBal.sub(amount))

      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(amount2.div(3)))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount.sub(amount2.div(3)))
      expect(await stRSR.balanceOf(addr3.address)).to.equal(amount.sub(amount2.div(3)))
    })

    it('Should remove RSR from Withdrawers', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Unstake with delay
      const stkWithdrawalDelay = 20000
      await main.connect(owner).setStRSRWithdrawalDelay(stkWithdrawalDelay)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Check withdrawal properly registered
      let [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      // Seize RSR
      await assetManager.connect(owner).seizeRSR(amount2)

      // Check balances, stakes, and withdrawals
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.sub(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      // Check impacted withdrawal
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount.sub(amount2))
    })

    it('Should remove RSR proportionally from Stakers and Withdrawers', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Unstake with delay
      const stkWithdrawalDelay = 20000
      await main.connect(owner).setStRSRWithdrawalDelay(stkWithdrawalDelay)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Check withdrawal properly registered
      let [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Seize RSR
      await assetManager.connect(owner).seizeRSR(amount2)

      // Check balances, stakes, and withdrawals
      const proportionalAmountToSeize: BigNumber = amount2.div(2)

      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2).sub(amount2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount.sub(proportionalAmountToSeize))

      // // Check impacted withdrawal
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount.sub(proportionalAmountToSeize))
    })
  })

  describe('Transfers', () => {
    let amount: BigNumber

    beforeEach(async function () {
      // Stake some RSR
      amount = bn('10e18')

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)

      await stRSR.connect(addr1).stake(amount)
    })

    it('Should transfer stakes between accounts', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      //  Perform transfer
      await stRSR.connect(addr1).transfer(addr2.address, amount)

      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev.add(amount))
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not transfer stakes if no balance', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      //  Perform transfer with user with no stake
      await expect(stRSR.connect(addr2).transfer(addr1.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should transferFrom stakes between accounts', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Set allowance and transfer
      await stRSR.connect(addr1).approve(addr2.address, amount)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount)

      await stRSR.connect(addr2).transferFrom(addr1.address, other.address, amount)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.balanceOf(other.address)).to.equal(amount)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not transferFrom stakes if no allowance', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Set allowance and transfer
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
      await expect(stRSR.connect(addr2).transferFrom(addr1.address, other.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.balanceOf(other.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })
  })
})
