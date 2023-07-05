import { networkConfig } from '#/common/configuration'
import { useEnv } from '#/utils/env'
import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { allocateUSDC, makewstgSUDC, mintWStgUSDC } from './helpers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  IStargatePool,
  StargatePoolWrapper__factory,
  IStargatePoolWrapper,
  ERC20Mock,
  IStargateRouter,
  StargatePoolMock,
  StargateLPStakingMock,
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
  let wstgUSDC: IStargatePoolWrapper
  let stgUSDC: IStargatePool
  let router: IStargateRouter
  let StargatePoolWrapperFactory: StargatePoolWrapper__factory

  let chainId: number

  before(async () => {
    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    StargatePoolWrapperFactory = <StargatePoolWrapper__factory>(
      await ethers.getContractFactory('StargatePoolWrapper')
    )
  })

  beforeEach(async () => {
    ;[, bob, charles, don] = await ethers.getSigners()
    ;({ usdc, wstgUSDC, stgUSDC, router } = await loadFixture(makewstgSUDC))
  })

  describe('Deployment', () => {
    it('reverts if deployed with a 0 address for STG token or LP staking contract', async () => {
      await expect(
        StargatePoolWrapperFactory.deploy(
          WSUSDC_NAME,
          WSUSDC_SYMBOL,
          ZERO_ADDRESS,
          STAKING_CONTRACT,
          SUSDC
        )
      ).to.be.reverted

      await expect(
        StargatePoolWrapperFactory.deploy(WSUSDC_NAME, WSUSDC_SYMBOL, STARGATE, ZERO_ADDRESS, SUSDC)
      ).to.be.reverted
    })

    it('reverts if deployed with no name or symbol', async () => {
      await expect(
        StargatePoolWrapperFactory.deploy('', WSUSDC_SYMBOL, STARGATE, STAKING_CONTRACT, SUSDC)
      ).to.be.reverted

      await expect(
        StargatePoolWrapperFactory.deploy(WSUSDC_NAME, '', STARGATE, STAKING_CONTRACT, SUSDC)
      ).to.be.reverted
    })

    it('reverts if deployed with invalid pool', async () => {
      await expect(
        StargatePoolWrapperFactory.deploy(
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
      await wstgUSDC.connect(bob).deposit(await stgUSDC.balanceOf(bob.address))

      expect(await stgUSDC.balanceOf(bob.address)).to.equal(0)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(amount, 10)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
    })

    it('deposits less than available S*USDC', async () => {
      const depositAmount = await stgUSDC.balanceOf(bob.address).then((e) => e.div(2))

      await wstgUSDC.connect(bob).deposit(depositAmount)

      expect(await stgUSDC.balanceOf(bob.address)).to.be.closeTo(depositAmount, 10)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(depositAmount, 10)
    })

    it('has accurate balances when doing multiple deposits', async () => {
      const depositAmount = await stgUSDC.balanceOf(bob.address)

      await wstgUSDC.connect(bob).deposit(depositAmount.mul(3).div(4))
      await advanceTime(1000)
      await wstgUSDC.connect(bob).deposit(depositAmount.mul(1).div(4))

      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(depositAmount, 10)
    })

    it('updates the totalSupply', async () => {
      const totalSupplyBefore = await wstgUSDC.totalSupply()
      const expectedAmount = await stgUSDC.balanceOf(bob.address)

      await wstgUSDC.connect(bob).deposit(expectedAmount)
      expect(await wstgUSDC.totalSupply()).to.equal(totalSupplyBefore.add(expectedAmount))
    })

    it('reverts on depositing 0', async () => {
      await expect(wstgUSDC.connect(bob).deposit(0)).to.be.revertedWith('Invalid amount')
    })
  })

  describe('Withdraw', () => {
    const initwusdcAmt = bn('20000e6')

    beforeEach(async () => {
      await mintWStgUSDC(usdc, stgUSDC, wstgUSDC, bob, initwusdcAmt)
      await mintWStgUSDC(usdc, stgUSDC, wstgUSDC, charles, initwusdcAmt)
    })

    it('withdraws to own account', async () => {
      await wstgUSDC.connect(bob).withdraw(await wstgUSDC.balanceOf(bob.address))
      const bal = await wstgUSDC.balanceOf(bob.address)

      expect(bal).to.closeTo(bn('0'), 10)
      expect(await stgUSDC.balanceOf(bob.address)).to.closeTo(initwusdcAmt, 10)
    })

    it('withdraws all balance via multiple withdrawals', async () => {
      const initialBalance = await wstgUSDC.balanceOf(bob.address)

      const withdrawAmt = initialBalance.div(2)
      await wstgUSDC.connect(bob).withdraw(withdrawAmt)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(initialBalance.sub(withdrawAmt), 0)

      await advanceTime(1000)

      await wstgUSDC.connect(bob).withdraw(withdrawAmt)
      expect(await wstgUSDC.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
    })

    it('withdrawing 0 reverts', async () => {
      const initialBalance = await wstgUSDC.balanceOf(bob.address)
      await expect(wstgUSDC.connect(bob).withdraw(0)).to.be.revertedWith('Invalid amount')
      expect(await wstgUSDC.balanceOf(bob.address)).to.equal(initialBalance)
    })

    it('handles complex withdrawal sequence', async () => {
      let bobWithdrawn = bn('0')
      let charlesWithdrawn = bn('0')
      let donWithdrawn = bn('0')

      const firstWithdrawAmt = await wstgUSDC.balanceOf(charles.address).then((e) => e.div(2))

      charlesWithdrawn = charlesWithdrawn.add(firstWithdrawAmt)

      await wstgUSDC.connect(charles).withdraw(firstWithdrawAmt)
      const newBalanceCharles = await stgUSDC.balanceOf(charles.address)
      expect(newBalanceCharles).to.closeTo(firstWithdrawAmt, 10)

      // don deposits
      await mintWStgUSDC(usdc, stgUSDC, wstgUSDC, don, initwusdcAmt)

      // bob withdraws SOME
      bobWithdrawn = bobWithdrawn.add(bn('12345e6'))
      await wstgUSDC.connect(bob).withdraw(bn('12345e6'))

      // don withdraws SOME
      donWithdrawn = donWithdrawn.add(bn('123e6'))
      await wstgUSDC.connect(don).withdraw(bn('123e6'))

      // charles withdraws ALL
      const charlesRemainingBalance = await wstgUSDC.balanceOf(charles.address)
      charlesWithdrawn = charlesWithdrawn.add(charlesRemainingBalance)
      await wstgUSDC.connect(charles).withdraw(charlesRemainingBalance)

      // don withdraws ALL
      const donRemainingBalance = await wstgUSDC.balanceOf(don.address)
      donWithdrawn = donWithdrawn.add(donRemainingBalance)
      await wstgUSDC.connect(don).withdraw(donRemainingBalance)

      // bob withdraws ALL
      const bobRemainingBalance = await wstgUSDC.balanceOf(bob.address)
      bobWithdrawn = bobWithdrawn.add(bobRemainingBalance)
      await wstgUSDC.connect(bob).withdraw(bobRemainingBalance)

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
      await wstgUSDC.connect(bob).withdraw(withdrawAmt)

      expect(await wstgUSDC.totalSupply()).to.be.closeTo(totalSupplyBefore.sub(expectedDiff), 10)
    })
  })

  describe('Rewards', () => {
    let stakingContract: StargateLPStakingMock
    let stargate: ERC20Mock
    let mockPool: StargatePoolMock
    let wrapper: IStargatePoolWrapper

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
      wrapper = await StargatePoolWrapperFactory.deploy(
        'wMS*USDC',
        'wMS*USDC',
        stargate.address,
        stakingContract.address,
        mockPool.address
      )
      await mockPool.connect(bob).approve(wrapper.address, ethers.constants.MaxUint256)
      await mockPool.mint(bob.address, initialAmount)
      await wrapper.connect(bob).deposit(initialAmount)
    })

    it('emits previous rewards upon depositing', async () => {
      await stakingContract.addRewardsToUser(bn('0'), wrapper.address, bn('20000e18'))
      const availableReward = await stakingContract.pendingStargate('0', wrapper.address)
      await mockPool.mint(bob.address, initialAmount)
      await wrapper.connect(bob).deposit(await mockPool.balanceOf(bob.address))
      expect(availableReward).to.be.eq(await stargate.balanceOf(bob.address))
    })

    it('emits previous rewards upon withdrawal', async () => {
      await stakingContract.addRewardsToUser(bn('0'), wrapper.address, bn('20000e18'))
      const availableReward = await stakingContract.pendingStargate('0', wrapper.address)

      await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address))
      expect(availableReward).to.be.eq(await stargate.balanceOf(bob.address))
    })

    describe('Tracking', () => {
      it('tracks slightly complex', async () => {
        const rewardIncrement = bn('20000e18')
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )
        await mockPool.mint(charles.address, initialAmount)
        await mockPool.connect(charles).approve(wrapper.address, ethers.constants.MaxUint256)
        await wrapper.connect(charles).deposit(await mockPool.balanceOf(charles.address))
        expect(await stargate.balanceOf(wrapper.address)).to.be.eq(rewardIncrement)
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement.mul(2))
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(2)
        )
        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address))
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(2))
        await wrapper.connect(charles).withdraw(await wrapper.balanceOf(charles.address))
        expect(await stargate.balanceOf(charles.address)).to.be.eq(rewardIncrement)
      })

      it('tracks moderately complex sequence', async () => {
        const rewardIncrement = bn('20000e18')
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )

        // bob rewards - 20k
        // charles rewards - 0
        await mockPool.mint(charles.address, initialAmount)
        await mockPool.connect(charles).approve(wrapper.address, ethers.constants.MaxUint256)
        await wrapper.connect(charles).deposit(await mockPool.balanceOf(charles.address))
        expect(await stargate.balanceOf(wrapper.address)).to.be.eq(rewardIncrement)
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement.mul(2))
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(2)
        )

        // bob rewards - 40k
        // charles rewards - 20k
        await wrapper.connect(bob).withdraw(initialAmount.div(2))
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(2))
        expect(await stargate.balanceOf(wrapper.address)).to.be.eq(rewardIncrement)

        // bob rewards - 0
        // charles rewards - 20k
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement.mul(3))
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(3)
        )

        // bob rewards - 20k
        // charles rewards - 60k
        await wrapper.connect(charles).withdraw(await wrapper.balanceOf(charles.address))
        expect(await stargate.balanceOf(charles.address)).to.be.eq(rewardIncrement.mul(3))

        // bob rewards - 20k
        // charles rewards - 0
        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address))
        expect(await stargate.balanceOf(bob.address)).to.be.eq(rewardIncrement.mul(3))
      })
    })

    describe('Transfers', () => {
      it('maintains user rewards when transfering tokens', async () => {
        const rewardIncrement = bn('20000e18')
        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )
        // bob rewards - 20k
        // charles rewards - 0

        // doesn't claim pending rewards to wrapper
        await wrapper.connect(bob).transfer(charles.address, initialAmount.div(2))
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement
        )
        expect(await wrapper.balanceOf(bob.address)).to.be.eq(initialAmount.div(2))
        expect(await wrapper.balanceOf(charles.address)).to.be.eq(initialAmount.div(2))
        // bob rewards - 20k
        // charles rewards - 0

        await stakingContract.addRewardsToUser(bn('0'), wrapper.address, rewardIncrement)
        expect(await stakingContract.pendingStargate(bn('0'), wrapper.address)).to.be.eq(
          rewardIncrement.mul(2)
        )
        // bob rewards - 30k
        // charles rewards - 10k

        await wrapper.connect(charles).withdraw(await wrapper.balanceOf(charles.address))
        expect(await stargate.balanceOf(charles.address)).to.be.eq(rewardIncrement.div(2))
        // bob rewards - 30k
        // charles rewards - 0

        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address))
        expect(await stargate.balanceOf(bob.address)).to.be.eq(
          rewardIncrement.div(2).add(rewardIncrement)
        )
        // bob rewards - 0
        // charles rewards - 0
      })
    })
  })
})
