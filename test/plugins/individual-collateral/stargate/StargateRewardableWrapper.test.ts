import { networkConfig } from '#/common/configuration'
import { useEnv } from '#/utils/env'
import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { allocateUSDC, makewstgSUDC, mintWStgUSDC } from './helpers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  IStargatePool,
  ERC20Mock,
  IStargateRouter,
  StargatePoolMock,
  StargateLPStakingMock,
  StargateRewardableWrapper__factory,
  StargateRewardableWrapper,
} from '@typechain/index'
import { expect } from 'chai'
import { ZERO_ADDRESS } from '#/common/constants'
import { STAKING_CONTRACT, WSUSDC_NAME, WSUSDC_SYMBOL, STARGATE, SUSDC } from './constants'
import { bn } from '#/common/numbers'
import { getChainId } from '#/common/blockchain-utils'
import { advanceTime } from '#/test/utils/time'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('Wrapped S*USDC', () => {
  let bob: SignerWithAddress
  let charles: SignerWithAddress
  let don: SignerWithAddress
  let usdc: ERC20Mock
  let wstgUSDC: StargateRewardableWrapper
  let stgUSDC: IStargatePool
  let router: IStargateRouter
  let StargateRewardableWrapperFactory: StargateRewardableWrapper__factory

  let chainId: number

  before(async () => {
    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    StargateRewardableWrapperFactory = <StargateRewardableWrapper__factory>(
      await ethers.getContractFactory('StargateRewardableWrapper')
    )
  })

  beforeEach(async () => {
    ;[, bob, charles, don] = await ethers.getSigners()
    ;({ usdc, wstgUSDC, stgUSDC, router } = await loadFixture(makewstgSUDC))
  })

  describe('Deployment', () => {
    it('reverts if deployed with a 0 address for STG token or LP staking contract', async () => {
      await expect(
        StargateRewardableWrapperFactory.deploy(
          WSUSDC_NAME,
          WSUSDC_SYMBOL,
          ZERO_ADDRESS,
          STAKING_CONTRACT,
          SUSDC
        )
      ).to.be.reverted

      await expect(
        StargateRewardableWrapperFactory.deploy(
          WSUSDC_NAME,
          WSUSDC_SYMBOL,
          STARGATE,
          ZERO_ADDRESS,
          SUSDC
        )
      ).to.be.reverted
    })

    it('reverts if deployed with invalid pool', async () => {
      await expect(
        StargateRewardableWrapperFactory.deploy(
          WSUSDC_NAME,
          WSUSDC_SYMBOL,
          STARGATE,
          STAKING_CONTRACT,
          ZERO_ADDRESS
        )
      ).to.be.reverted
    })
  })

  describe('Deposit', () => {
    const amount = bn(20000e6)

    beforeEach(async () => {
      const requiredAmount = await stgUSDC.amountLPtoLD(amount)

      await allocateUSDC(bob.address, requiredAmount.sub(await usdc.balanceOf(bob.address)))

      await usdc.connect(bob).approve(router.address, requiredAmount)
      await router.connect(bob).addLiquidity(await stgUSDC.poolId(), requiredAmount, bob.address)

      await stgUSDC.connect(bob).approve(wstgUSDC.address, ethers.constants.MaxUint256)
    })

    it('deposits correct amount', async () => {
      await wstgUSDC.connect(bob).deposit(await stgUSDC.balanceOf(bob.address), bob.address)

      expect(await stgUSDC.balanceOf(bob.address)).to.equal(0)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(amount, 10)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
    })

    it('deposits less than available S*USDC', async () => {
      const depositAmount = await stgUSDC.balanceOf(bob.address).then((e) => e.div(2))

      await wstgUSDC.connect(bob).deposit(depositAmount, bob.address)

      expect(await stgUSDC.balanceOf(bob.address)).to.be.closeTo(depositAmount, 10)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(depositAmount, 10)
    })

    it('has accurate balances when doing multiple deposits', async () => {
      const depositAmount = await stgUSDC.balanceOf(bob.address)

      await wstgUSDC.connect(bob).deposit(depositAmount.mul(3).div(4), bob.address)
      await advanceTime(1000)
      await wstgUSDC.connect(bob).deposit(depositAmount.mul(1).div(4), bob.address)

      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(depositAmount, 10)
    })

    it('updates the totalSupply', async () => {
      const totalSupplyBefore = await wstgUSDC.totalSupply()
      const expectedAmount = await stgUSDC.balanceOf(bob.address)

      await wstgUSDC.connect(bob).deposit(expectedAmount, bob.address)
      expect(await wstgUSDC.totalSupply()).to.equal(totalSupplyBefore.add(expectedAmount))
    })
  })

  describe('Withdraw', () => {
    const initwusdcAmt = bn('20000e6')

    beforeEach(async () => {
      await mintWStgUSDC(usdc, stgUSDC, wstgUSDC, bob, initwusdcAmt)
      await mintWStgUSDC(usdc, stgUSDC, wstgUSDC, charles, initwusdcAmt)
    })

    it('withdraws to own account', async () => {
      await wstgUSDC.connect(bob).withdraw(await wstgUSDC.balanceOf(bob.address), bob.address)
      const bal = await wstgUSDC.balanceOf(bob.address)

      expect(bal).to.closeTo(bn('0'), 10)
      expect(await stgUSDC.balanceOf(bob.address)).to.closeTo(initwusdcAmt, 10)
    })

    it('withdraws all balance via multiple withdrawals', async () => {
      const initialBalance = await wstgUSDC.balanceOf(bob.address)

      const withdrawAmt = initialBalance.div(2)
      await wstgUSDC.connect(bob).withdraw(withdrawAmt, bob.address)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(initialBalance.sub(withdrawAmt), 0)

      await advanceTime(1000)

      await wstgUSDC.connect(bob).withdraw(withdrawAmt, bob.address)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
    })

    it('handles complex withdrawal sequence', async () => {
      let bobWithdrawn = bn('0')
      let charlesWithdrawn = bn('0')
      let donWithdrawn = bn('0')

      const firstWithdrawAmt = await wstgUSDC.balanceOf(charles.address).then((e) => e.div(2))

      charlesWithdrawn = charlesWithdrawn.add(firstWithdrawAmt)

      await wstgUSDC.connect(charles).withdraw(firstWithdrawAmt, charles.address)
      const newBalanceCharles = await stgUSDC.balanceOf(charles.address)
      expect(newBalanceCharles).to.closeTo(firstWithdrawAmt, 10)

      // don deposits
      await mintWStgUSDC(usdc, stgUSDC, wstgUSDC, don, initwusdcAmt)

      // bob withdraws SOME
      bobWithdrawn = bobWithdrawn.add(bn('12345e6'))
      await wstgUSDC.connect(bob).withdraw(bn('12345e6'), bob.address)

      // don withdraws SOME
      donWithdrawn = donWithdrawn.add(bn('123e6'))
      await wstgUSDC.connect(don).withdraw(bn('123e6'), don.address)

      // charles withdraws ALL
      const charlesRemainingBalance = await wstgUSDC.balanceOf(charles.address)
      charlesWithdrawn = charlesWithdrawn.add(charlesRemainingBalance)
      await wstgUSDC.connect(charles).withdraw(charlesRemainingBalance, charles.address)

      // don withdraws ALL
      const donRemainingBalance = await wstgUSDC.balanceOf(don.address)
      donWithdrawn = donWithdrawn.add(donRemainingBalance)
      await wstgUSDC.connect(don).withdraw(donRemainingBalance, don.address)

      // bob withdraws ALL
      const bobRemainingBalance = await wstgUSDC.balanceOf(bob.address)
      bobWithdrawn = bobWithdrawn.add(bobRemainingBalance)
      await wstgUSDC.connect(bob).withdraw(bobRemainingBalance, bob.address)

      const bal = await wstgUSDC.balanceOf(bob.address)

      expect(bal).to.closeTo(bn('0'), 10)
      expect(await stgUSDC.balanceOf(bob.address)).to.closeTo(bobWithdrawn, 100)
      expect(await stgUSDC.balanceOf(charles.address)).to.closeTo(charlesWithdrawn, 100)
      expect(await stgUSDC.balanceOf(don.address)).to.closeTo(donWithdrawn, 100)
    })

    it('updates the totalSupply', async () => {
      const totalSupplyBefore = await wstgUSDC.totalSupply()
      const withdrawAmt = bn('15000e6')
      const expectedDiff = withdrawAmt
      await wstgUSDC.connect(bob).withdraw(withdrawAmt, bob.address)

      expect(await wstgUSDC.totalSupply()).to.be.closeTo(totalSupplyBefore.sub(expectedDiff), 10)
    })
  })

  describe('Rewards', () => {
    let stakingContract: StargateLPStakingMock
    let stargate: ERC20Mock
    let mockPool: StargatePoolMock
    let wrapper: StargateRewardableWrapper

    const initialAmount = bn('20000e6')

    beforeEach(async () => {
      stargate = await (
        await ethers.getContractFactory('ERC20Mock')
      ).deploy('Stargate Mocked Token', 'S*MT')
      stakingContract = await (
        await ethers.getContractFactory('StargateLPStakingMock')
      ).deploy(stargate.address)
      mockPool = await (
        await ethers.getContractFactory('StargatePoolMock')
      ).deploy('Mock S*USDC', 'MS*USDC', 6)
      await stakingContract.add(bn('5000'), mockPool.address)
      wrapper = await StargateRewardableWrapperFactory.deploy(
        'wMS*USDC',
        'wMS*USDC',
        stargate.address,
        stakingContract.address,
        mockPool.address
      )
      await mockPool.connect(bob).approve(wrapper.address, ethers.constants.MaxUint256)
      await mockPool.mint(bob.address, initialAmount)
      await wrapper.connect(bob).deposit(initialAmount, bob.address)
    })

    it('claims previous rewards', async () => {
      await wrapper.connect(bob).deposit(await mockPool.balanceOf(bob.address), bob.address)
      await stakingContract.addRewardsToUser(bn('0'), wrapper.address, bn('20000e18'))
      const availableReward = await stakingContract.pendingEmissionToken('0', wrapper.address)
      await mockPool.mint(bob.address, initialAmount)
      await wrapper.connect(bob).claimRewards()

      expect(availableReward).to.be.eq(await stargate.balanceOf(bob.address))
    })

    it('regression: wrapper works even if staking contract is out of funds', async () => {
      await wrapper.connect(bob).deposit(await mockPool.balanceOf(bob.address), bob.address)
      await stakingContract.addRewardsToUser(bn('0'), wrapper.address, bn('20000e18'))
      await stakingContract.setAvailableRewards(0)

      await wrapper.connect(bob).transfer(charles.address, await wrapper.balanceOf(bob.address))
    })

    describe('Tracking', () => {
      it('tracks slightly complex', async () => {
        const rewardIncrement = bn('20000e18')
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )
        await mockPool.mint(charles.address, initialAmount)
        await mockPool.connect(charles).approve(wrapper.address, ethers.constants.MaxUint256)
        await wrapper
          .connect(charles)
          .deposit(await mockPool.balanceOf(charles.address), charles.address)
        await wrapper.connect(charles).claimRewards()
        expect(await stargate.balanceOf(wrapper.address)).to.be.eq(rewardIncrement)
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement.mul(2))
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(2)
        )
        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address), bob.address)
        await wrapper.connect(bob).claimRewards()
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(2))
        await wrapper
          .connect(charles)
          .withdraw(await wrapper.balanceOf(charles.address), charles.address)
        await wrapper.connect(charles).claimRewards()
        expect(await stargate.balanceOf(charles.address)).to.be.eq(rewardIncrement)
      })

      it('tracks moderately complex sequence', async () => {
        const rewardIncrement = bn('20000e18')
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )

        // bob rewards - 20k
        // charles rewards - 0
        await mockPool.mint(charles.address, initialAmount)
        await mockPool.connect(charles).approve(wrapper.address, ethers.constants.MaxUint256)
        await wrapper
          .connect(charles)
          .deposit(await mockPool.balanceOf(charles.address), charles.address)
        await wrapper.connect(charles).claimRewards()
        expect(await stargate.balanceOf(wrapper.address)).to.be.eq(rewardIncrement)
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement.mul(2))
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(2)
        )

        // bob rewards - 40k
        // charles rewards - 20k
        await wrapper.connect(bob).withdraw(initialAmount.div(2), bob.address)
        await wrapper.connect(bob).claimRewards()
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(2))
        expect(await stargate.balanceOf(wrapper.address)).to.be.eq(rewardIncrement)

        // bob rewards - 0
        // charles rewards - 20k
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement.mul(3))
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(3)
        )

        // bob rewards - 20k
        // charles rewards - 60k
        await wrapper
          .connect(charles)
          .withdraw(await wrapper.balanceOf(charles.address), charles.address)
        await wrapper.connect(charles).claimRewards()
        expect(await stargate.balanceOf(charles.address)).to.be.eq(rewardIncrement.mul(3))

        // bob rewards - 20k
        // charles rewards - 0
        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address), bob.address)
        await wrapper.connect(bob).claimRewards()
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(3))
      })
    })

    describe('Transfers', () => {
      it('maintains user rewards when transferring tokens', async () => {
        const rewardIncrement = bn('20000e18')
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )
        // bob rewards - 20k
        // charles rewards - 0

        // claims pending rewards to wrapper
        await wrapper.connect(bob).transfer(charles.address, initialAmount.div(2))
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(0)
        expect(await wrapper.balanceOf(bob.address)).to.be.eq(initialAmount.div(2))
        expect(await wrapper.balanceOf(charles.address)).to.be.eq(initialAmount.div(2))
        // bob rewards - 20k
        // charles rewards - 0

        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingEmissionToken(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )
        // bob rewards - 30k
        // charles rewards - 10k

        await wrapper
          .connect(charles)
          .withdraw(await wrapper.balanceOf(charles.address), charles.address)
        await wrapper.connect(charles).claimRewards()
        expect(await stargate.balanceOf(charles.address)).to.be.eq(rewardIncrement.div(2))
        // bob rewards - 30k
        // charles rewards - 0

        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address), bob.address)
        await wrapper.connect(bob).claimRewards()
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(3).div(2))
        // bob rewards - 0
        // charles rewards - 0
      })
    })

    describe('Emergency - Ignore Rewards', () => {
      const amount = bn('20000e6')

      beforeEach(async () => {
        const requiredAmount = await stgUSDC.amountLPtoLD(amount)

        await allocateUSDC(bob.address, requiredAmount.sub(await usdc.balanceOf(bob.address)))

        await usdc.connect(bob).approve(router.address, requiredAmount)
        await router.connect(bob).addLiquidity(await stgUSDC.poolId(), requiredAmount, bob.address)

        await stgUSDC.connect(bob).approve(wstgUSDC.address, ethers.constants.MaxUint256)
      })

      it('deposits & withdraws correctly when in emergency already', async () => {
        // Set staking contract in emergency mode
        await stakingContract.setAllocPoint(0, 0)

        await wstgUSDC.connect(bob).deposit(await stgUSDC.balanceOf(bob.address), bob.address)

        expect(await stgUSDC.balanceOf(bob.address)).to.equal(0)
        expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(amount, 10)
        expect(await usdc.balanceOf(bob.address)).to.equal(0)

        await wstgUSDC.connect(bob).withdraw(await wstgUSDC.balanceOf(bob.address), bob.address)

        expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
        expect(await stgUSDC.balanceOf(bob.address)).to.closeTo(amount, 10)
      })

      it('deposits & withdraws correctly when put in emergency while operating', async () => {
        await wstgUSDC.connect(bob).deposit(await stgUSDC.balanceOf(bob.address), bob.address)

        expect(await stgUSDC.balanceOf(bob.address)).to.equal(0)
        expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(amount, 10)
        expect(await usdc.balanceOf(bob.address)).to.equal(0)

        // Set staking contract in emergency mode
        await stakingContract.setAllocPoint(0, 0)

        await wstgUSDC.connect(bob).withdraw(await wstgUSDC.balanceOf(bob.address), bob.address)

        expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
        expect(await stgUSDC.balanceOf(bob.address)).to.closeTo(amount, 10)
      })
    })
  })
})
