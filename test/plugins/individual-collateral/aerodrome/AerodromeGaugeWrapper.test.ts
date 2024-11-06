import { networkConfig } from '#/common/configuration'
import { useEnv } from '#/utils/env'
import hre, { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { mintLpToken, mintWrappedLpToken, resetFork, allStableTests } from './helpers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  IAeroPool,
  ERC20Mock,
  AerodromeGaugeWrapper__factory,
  AerodromeGaugeWrapper,
  IAeroGauge,
} from '@typechain/index'
import { expect } from 'chai'
import { ZERO_ADDRESS } from '#/common/constants'
import { forkNetwork, AERO, eUSD } from './constants'
import { bn, fp } from '#/common/numbers'
import { getChainId } from '#/common/blockchain-utils'
import { advanceTime } from '#/test/utils/time'

for (const curr of allStableTests) {
  const describeFork = useEnv('FORK') && forkNetwork == 'base' ? describe : describe.skip

  const onePct = (value: BigNumber): BigNumber => {
    return value.div(100)
  }
  describeFork(`Gauge Wrapper - ${curr.testName}`, () => {
    let bob: SignerWithAddress
    let charles: SignerWithAddress
    let don: SignerWithAddress
    let aero: ERC20Mock
    let gauge: IAeroGauge
    let wrapper: AerodromeGaugeWrapper
    let lpToken: IAeroPool
    let AerodromeGaugeWrapperFactory: AerodromeGaugeWrapper__factory

    let chainId: number

    before(async () => {
      await resetFork()

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }

      AerodromeGaugeWrapperFactory = <AerodromeGaugeWrapper__factory>(
        await ethers.getContractFactory('AerodromeGaugeWrapper')
      )
    })

    beforeEach(async () => {
      ;[, bob, charles, don] = await ethers.getSigners()
      ;({ wrapper, lpToken } = await loadFixture(curr.fix))
      gauge = await ethers.getContractAt('IAeroGauge', curr.gauge)
    })

    describe('Deployment', () => {
      it('reverts if deployed with a 0 address for AERO token or staking contract', async () => {
        await expect(
          AerodromeGaugeWrapperFactory.deploy(
            curr.pool,
            await wrapper.name(),
            await wrapper.symbol(),
            ZERO_ADDRESS,
            curr.gauge
          )
        ).to.be.reverted

        await expect(
          AerodromeGaugeWrapperFactory.deploy(
            curr.pool,
            await wrapper.name(),
            await wrapper.symbol(),
            AERO,
            ZERO_ADDRESS
          )
        ).to.be.reverted
      })

      it('reverts if deployed with invalid pool', async () => {
        await expect(
          AerodromeGaugeWrapperFactory.deploy(
            ZERO_ADDRESS,
            await wrapper.name(),
            await wrapper.symbol(),
            AERO,
            curr.gauge
          )
        ).to.be.reverted
      })

      it('reverts if deployed with invalid AERO token', async () => {
        const INVALID_AERO = eUSD // mock (any erc20)
        await expect(
          AerodromeGaugeWrapperFactory.deploy(
            curr.pool,
            await wrapper.name(),
            await wrapper.symbol(),
            INVALID_AERO,
            curr.gauge
          )
        ).to.be.revertedWith('wrong Aero')
      })
    })

    describe('Deposit', () => {
      const amount = fp('0.02')

      beforeEach(async () => {
        await mintLpToken(gauge, lpToken, amount, curr.holder, bob.address)
        await lpToken.connect(bob).approve(wrapper.address, ethers.constants.MaxUint256)
      })

      it('deposits correct amount', async () => {
        const balanceInLPPrev = await lpToken.balanceOf(bob.address)

        await wrapper.connect(bob).deposit(await lpToken.balanceOf(bob.address), bob.address)

        expect(await lpToken.balanceOf(bob.address)).to.equal(0)
        expect(await wrapper.balanceOf(bob.address)).to.equal(balanceInLPPrev)
      })

      it('deposits less than available', async () => {
        const depositAmount = await lpToken.balanceOf(bob.address).then((e) => e.div(2))

        await wrapper.connect(bob).deposit(depositAmount, bob.address)

        expect(await lpToken.balanceOf(bob.address)).to.be.closeTo(depositAmount, 10)
        expect(await wrapper.balanceOf(bob.address)).to.closeTo(depositAmount, 10)
      })

      it('has accurate balances when doing multiple deposits', async () => {
        const depositAmount = await lpToken.balanceOf(bob.address)
        await wrapper.connect(bob).deposit(depositAmount.mul(3).div(4), bob.address)

        await advanceTime(1000)
        await wrapper.connect(bob).deposit(depositAmount.mul(1).div(4), bob.address)

        expect(await wrapper.balanceOf(bob.address)).to.closeTo(depositAmount, 10)
      })

      it('updates the totalSupply', async () => {
        const totalSupplyBefore = await wrapper.totalSupply()
        const expectedAmount = await lpToken.balanceOf(bob.address)

        await wrapper.connect(bob).deposit(expectedAmount, bob.address)
        expect(await wrapper.totalSupply()).to.equal(totalSupplyBefore.add(expectedAmount))
      })

      it('handles deposits with 0 amount', async () => {
        const balanceInLPPrev = await lpToken.balanceOf(bob.address)

        await expect(wrapper.connect(bob).deposit(0, bob.address)).to.not.be.reverted

        expect(await lpToken.balanceOf(bob.address)).to.equal(balanceInLPPrev)
        expect(await wrapper.balanceOf(bob.address)).to.equal(0)
      })
    })

    describe('Withdraw', () => {
      const initAmt = fp('0.02')

      beforeEach(async () => {
        await mintWrappedLpToken(wrapper, gauge, lpToken, initAmt, curr.holder, bob, bob.address)
        await mintWrappedLpToken(
          wrapper,
          gauge,
          lpToken,
          initAmt,
          curr.holder,
          charles,
          charles.address
        )
      })

      it('withdraws to own account', async () => {
        const initialBal = await wrapper.balanceOf(bob.address)
        await wrapper.connect(bob).withdraw(await wrapper.balanceOf(bob.address), bob.address)
        const finalBal = await wrapper.balanceOf(bob.address)

        expect(finalBal).to.closeTo(bn('0'), 10)
        expect(await lpToken.balanceOf(bob.address)).to.closeTo(initialBal, 10)
      })

      it('withdraws all balance via multiple withdrawals', async () => {
        const initialBalance = await wrapper.balanceOf(bob.address)

        const withdrawAmt = initialBalance.div(2)
        await wrapper.connect(bob).withdraw(withdrawAmt, bob.address)
        expect(await wrapper.balanceOf(bob.address)).to.closeTo(initialBalance.sub(withdrawAmt), 0)

        await advanceTime(1000)

        await wrapper.connect(bob).withdraw(withdrawAmt, bob.address)
        expect(await wrapper.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
      })

      it('handles complex withdrawal sequence', async () => {
        let bobWithdrawn = bn('0')
        let charlesWithdrawn = bn('0')
        let donWithdrawn = bn('0')

        const firstWithdrawAmt = await wrapper.balanceOf(charles.address).then((e) => e.div(2))

        charlesWithdrawn = charlesWithdrawn.add(firstWithdrawAmt)

        await wrapper.connect(charles).withdraw(firstWithdrawAmt, charles.address)
        const newBalanceCharles = await lpToken.balanceOf(charles.address)
        expect(newBalanceCharles).to.closeTo(firstWithdrawAmt, 10)

        // don deposits
        await mintWrappedLpToken(wrapper, gauge, lpToken, initAmt, curr.holder, don, don.address)

        // bob withdraws SOME
        bobWithdrawn = bobWithdrawn.add(bn('12345e6'))
        await wrapper.connect(bob).withdraw(bn('12345e6'), bob.address)

        // don withdraws SOME
        donWithdrawn = donWithdrawn.add(bn('123e6'))
        await wrapper.connect(don).withdraw(bn('123e6'), don.address)

        // charles withdraws ALL
        const charlesRemainingBalance = await wrapper.balanceOf(charles.address)
        charlesWithdrawn = charlesWithdrawn.add(charlesRemainingBalance)
        await wrapper.connect(charles).withdraw(charlesRemainingBalance, charles.address)

        // don withdraws ALL
        const donRemainingBalance = await wrapper.balanceOf(don.address)
        donWithdrawn = donWithdrawn.add(donRemainingBalance)
        await wrapper.connect(don).withdraw(donRemainingBalance, don.address)

        // bob withdraws ALL
        const bobRemainingBalance = await wrapper.balanceOf(bob.address)
        bobWithdrawn = bobWithdrawn.add(bobRemainingBalance)
        await wrapper.connect(bob).withdraw(bobRemainingBalance, bob.address)

        const bal = await wrapper.balanceOf(bob.address)

        expect(bal).to.closeTo(bn('0'), 10)
        expect(await lpToken.balanceOf(bob.address)).to.closeTo(bobWithdrawn, 100)
        expect(await lpToken.balanceOf(charles.address)).to.closeTo(charlesWithdrawn, 100)
        expect(await lpToken.balanceOf(don.address)).to.closeTo(donWithdrawn, 100)
      })

      it('updates the totalSupply', async () => {
        const totalSupplyBefore = await wrapper.totalSupply()
        const withdrawAmt = bn('15000e6')
        const expectedDiff = withdrawAmt
        await wrapper.connect(bob).withdraw(withdrawAmt, bob.address)

        expect(await wrapper.totalSupply()).to.be.closeTo(totalSupplyBefore.sub(expectedDiff), 10)
      })
    })

    describe('Rewards', () => {
      const initialAmount = fp('0.02')

      beforeEach(async () => {
        aero = await ethers.getContractAt('ERC20Mock', AERO)
      })

      it('claims rewards from Aerodrome', async () => {
        await mintWrappedLpToken(
          wrapper,
          gauge,
          lpToken,
          initialAmount,
          curr.holder,
          bob,
          bob.address
        )

        const initialAeroBal = await aero.balanceOf(wrapper.address)

        await advanceTime(1000)

        let expectedRewards = await gauge.earned(wrapper.address)
        await wrapper.claimRewards()
        expect(await gauge.earned(wrapper.address)).to.equal(0) // all claimed

        const updatedAeroBal = await aero.balanceOf(wrapper.address)
        expect(updatedAeroBal).to.be.gt(initialAeroBal)
        expect(updatedAeroBal.sub(initialAeroBal)).to.be.closeTo(
          expectedRewards,
          onePct(expectedRewards)
        )

        await advanceTime(1000)

        expectedRewards = await gauge.earned(wrapper.address)
        await wrapper.claimRewards()
        expect(await gauge.earned(wrapper.address)).to.equal(0) // all claimed

        const finalAeroBal = await aero.balanceOf(wrapper.address)
        expect(finalAeroBal).to.be.gt(updatedAeroBal)
        expect(finalAeroBal.sub(updatedAeroBal)).to.be.closeTo(
          expectedRewards,
          onePct(expectedRewards)
        )
      })

      it('distributes rewards to holder', async () => {
        expect(await aero.balanceOf(bob.address)).to.equal(0)
        expect(await aero.balanceOf(don.address)).to.equal(0)

        // deposit with bob
        await mintWrappedLpToken(
          wrapper,
          gauge,
          lpToken,
          initialAmount,
          curr.holder,
          bob,
          bob.address
        )

        await advanceTime(1000)

        // sync rewards
        await wrapper.connect(bob).claimRewards()

        let expectedRewardsBob = await wrapper.accumulatedRewards(bob.address)

        // bob can claim and get rewards
        await wrapper.connect(bob).claimRewards()
        expect(await aero.balanceOf(bob.address)).to.be.gt(0)
        expect(await aero.balanceOf(bob.address)).to.be.closeTo(
          expectedRewardsBob,
          onePct(expectedRewardsBob)
        )

        // don does not have rewards
        await wrapper.connect(don).claimRewards()
        expect(await aero.balanceOf(don.address)).to.equal(0)

        // transfer some tokens to don
        const balToTransfer = (await wrapper.balanceOf(bob.address)).div(2)
        await wrapper.connect(bob).transfer(don.address, balToTransfer)

        await advanceTime(1000)

        // Now both have rewards
        await wrapper.connect(bob).claimRewards()
        expectedRewardsBob = await wrapper.accumulatedRewards(bob.address)
        expect(await aero.balanceOf(bob.address)).to.be.closeTo(
          expectedRewardsBob,
          onePct(expectedRewardsBob)
        )

        // Don also gets rewards
        await wrapper.connect(don).claimRewards()
        const expectedRewardsDon = await wrapper.accumulatedRewards(don.address)
        expect(await aero.balanceOf(don.address)).to.be.gt(0)
        expect(await aero.balanceOf(don.address)).to.be.closeTo(
          expectedRewardsDon,
          onePct(expectedRewardsDon)
        )
      })
    })
  })
}
