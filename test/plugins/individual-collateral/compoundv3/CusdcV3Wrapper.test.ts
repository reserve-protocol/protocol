import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import hre, { ethers, network } from 'hardhat'
import { useEnv } from '#/utils/env'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceTime, advanceBlocks } from '../../../utils/time'
import { allocateUSDC, enableRewardsAccrual, mintWcUSDC, makewCSUDC, resetFork } from './helpers'
import { forkNetwork, COMP, REWARDS } from './constants'
import {
  ERC20Mock,
  CometInterface,
  ICusdcV3Wrapper,
  CusdcV3Wrapper__factory,
} from '../../../../typechain'
import { bn } from '../../../../common/numbers'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MAX_UINT256, ZERO_ADDRESS } from '../../../../common/constants'

const describeFork = useEnv('FORK') ? describe : describe.skip

const itL1 = forkNetwork != 'base' && forkNetwork != 'arbitrum' ? it : it.skip

describeFork('Wrapped CUSDCv3', () => {
  let bob: SignerWithAddress
  let charles: SignerWithAddress
  let don: SignerWithAddress
  let usdc: ERC20Mock
  let wcusdcV3: ICusdcV3Wrapper
  let cusdcV3: CometInterface

  let chainId: number

  before(async () => {
    await resetFork()

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[, bob, charles, don] = await ethers.getSigners()
    ;({ usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC))
  })

  it('reverts if deployed with a 0 address', async () => {
    const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
      await ethers.getContractFactory('CusdcV3Wrapper')
    )

    // TODO there is a chai limitation that cannot catch custom errors during deployment
    await expect(CusdcV3WrapperFactory.deploy(ZERO_ADDRESS, REWARDS, COMP)).to.be.reverted
  })

  it('configuration/state', async () => {
    expect(await wcusdcV3.symbol()).to.equal('wcUSDCv3')
    expect(await wcusdcV3.name()).to.equal('Wrapped cUSDCv3')
    expect(await wcusdcV3.totalSupply()).to.equal(bn(0))

    expect(await wcusdcV3.underlyingComet()).to.equal(cusdcV3.address)
    expect(await wcusdcV3.rewardERC20()).to.equal(COMP)
  })

  describe('deposit', () => {
    const amount = bn('20000e6')

    beforeEach(async () => {
      await allocateUSDC(bob.address, amount)
      await usdc.connect(bob).approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3.connect(bob).supply(usdc.address, amount)
      await cusdcV3.connect(bob).allow(wcusdcV3.address, true)
    })

    it('deposit', async () => {
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(
        await cusdcV3.balanceOf(bob.address)
      )
      await wcusdcV3.connect(bob).deposit(ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(expectedAmount)
    })

    it('deposits to own account', async () => {
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(
        await cusdcV3.balanceOf(bob.address)
      )
      await wcusdcV3.connect(bob).depositTo(bob.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(expectedAmount)
    })

    it('deposits for someone else', async () => {
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(
        await cusdcV3.balanceOf(bob.address)
      )
      await wcusdcV3.connect(bob).depositTo(don.address, ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(don.address)).to.eq(expectedAmount)
    })

    it('checks for correct approval on deposit - regression test', async () => {
      await expect(
        wcusdcV3.connect(don).depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
      ).revertedWithCustomError(wcusdcV3, 'Unauthorized')

      // Provide approval on the wrapper
      await wcusdcV3.connect(bob).allow(don.address, true)

      const expectedAmount = await wcusdcV3.convertDynamicToStatic(
        await cusdcV3.balanceOf(bob.address)
      )

      // This should fail even when bob approved wcusdcv3 to spend his tokens,
      // because there is no explicit approval of cUSDCv3 from bob to don, only
      // approval on the wrapper
      await expect(
        wcusdcV3.connect(don).depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
      ).to.be.revertedWithCustomError(cusdcV3, 'Unauthorized')

      // Add explicit approval of cUSDCv3 and retry
      await cusdcV3.connect(bob).allow(don.address, true)
      await wcusdcV3
        .connect(don)
        .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(charles.address)).to.eq(expectedAmount)
    })

    it('deposits from a different account', async () => {
      expect(await wcusdcV3.balanceOf(charles.address)).to.eq(0)
      await expect(
        wcusdcV3.connect(don).depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
      ).revertedWithCustomError(wcusdcV3, 'Unauthorized')

      // Approval has to be on cUsdcV3, not the wrapper
      await cusdcV3.connect(bob).allow(don.address, true)
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(
        await cusdcV3.balanceOf(bob.address)
      )
      await wcusdcV3
        .connect(don)
        .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(charles.address)).to.eq(expectedAmount)
    })

    it('deposits less than available cusdc', async () => {
      const depositAmount = bn('10000e6')
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(depositAmount)
      await wcusdcV3.connect(bob).depositTo(bob.address, depositAmount)
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(depositAmount, 100)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.closeTo(expectedAmount, 100)
    })

    it('user that deposits must have same baseTrackingIndex as this Token in Comet', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, amount, bob.address)
      expect((await cusdcV3.callStatic.userBasic(wcusdcV3.address)).baseTrackingIndex).to.equal(
        await wcusdcV3.baseTrackingIndex(bob.address)
      )
    })

    it('multiple deposits lead to accurate balances', async () => {
      let expectedAmount = await wcusdcV3.convertDynamicToStatic(bn('10000e6'))
      await wcusdcV3.connect(bob).depositTo(bob.address, bn('10000e6'))
      await advanceTime(1000)
      expectedAmount = expectedAmount.add(await wcusdcV3.convertDynamicToStatic(bn('10000e6')))
      await wcusdcV3.connect(bob).depositTo(bob.address, bn('10000e6'))

      // The more wcUSDCv3 is minted, the higher its value is relative to cUSDCv3.
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.gt(amount)
      expect(await wcusdcV3.balanceOf(bob.address)).to.closeTo(expectedAmount, 100)

      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.closeTo(
        await cusdcV3.balanceOf(wcusdcV3.address),
        1
      )
    })

    it('updates the totalSupply', async () => {
      const totalSupplyBefore = await wcusdcV3.totalSupply()
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(
        await cusdcV3.balanceOf(bob.address)
      )
      await wcusdcV3.connect(bob).deposit(ethers.constants.MaxUint256)
      expect(await wcusdcV3.totalSupply()).to.equal(totalSupplyBefore.add(expectedAmount))
    })

    it('deposit 0 reverts', async () => {
      await expect(wcusdcV3.connect(bob).deposit(0)).to.be.revertedWithCustomError(
        wcusdcV3,
        'BadAmount'
      )
    })

    it('depositing 0 balance reverts', async () => {
      await cusdcV3.connect(bob).transfer(charles.address, ethers.constants.MaxUint256)
      await expect(
        wcusdcV3.connect(bob).deposit(ethers.constants.MaxUint256)
      ).to.be.revertedWithCustomError(wcusdcV3, 'BadAmount')
    })

    it('desposit to zero address reverts', async () => {
      await expect(
        wcusdcV3.connect(bob).depositTo(ZERO_ADDRESS, ethers.constants.MaxUint256)
      ).to.be.revertedWithCustomError(wcusdcV3, 'ZeroAddress')
    })
  })

  describe('withdraw', () => {
    const initwusdcAmt = bn('20000e6')

    beforeEach(async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, initwusdcAmt, bob.address)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charles, initwusdcAmt, charles.address)
    })

    it('withdraws to own account', async () => {
      // bob withdraws ALL
      const expectedAmountBob = await wcusdcV3.underlyingBalanceOf(bob.address)
      await wcusdcV3.connect(bob).withdraw(ethers.constants.MaxUint256)
      const bal = await wcusdcV3.balanceOf(bob.address)
      expect(bal).to.closeTo(bn('0'), 10)
      expect(await cusdcV3.balanceOf(bob.address)).to.closeTo(expectedAmountBob, 50)
    })

    it('withdraws to a different account', async () => {
      const expectedAmount = await wcusdcV3.underlyingBalanceOf(bob.address)
      await wcusdcV3.connect(bob).withdrawTo(don.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(don.address)).to.closeTo(expectedAmount, 100)
      expect(await wcusdcV3.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
    })

    it('withdraws from a different account', async () => {
      const withdrawAmount = await wcusdcV3.underlyingBalanceOf(bob.address)
      await expect(
        wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, withdrawAmount)
      ).to.be.revertedWithCustomError(wcusdcV3, 'Unauthorized')

      await wcusdcV3.connect(bob).allow(charles.address, true)
      await wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, withdrawAmount)

      expect(await cusdcV3.balanceOf(don.address)).to.closeTo(withdrawAmount, 100)
      expect(await cusdcV3.balanceOf(charles.address)).to.closeTo(bn('0'), 30)

      expect(await wcusdcV3.balanceOf(bob.address)).to.closeTo(bn(0), 100)
    })

    it('withdraws all underlying balance via multiple withdrawals', async () => {
      await advanceTime(1000)
      const initialBalance = await wcusdcV3.underlyingBalanceOf(bob.address)
      const withdrawAmt = bn('10000e6')
      await wcusdcV3.connect(bob).withdraw(withdrawAmt)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.closeTo(
        initialBalance.sub(withdrawAmt),
        50
      )
      await advanceTime(1000)
      await wcusdcV3.connect(bob).withdraw(ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.closeTo(bn('0'), 10)
    })

    it('withdrawing 0 reverts', async () => {
      const initialBalance = await wcusdcV3.balanceOf(bob.address)
      await expect(wcusdcV3.connect(bob).withdraw(0)).to.be.revertedWithCustomError(
        wcusdcV3,
        'BadAmount'
      )
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(initialBalance)
    })

    it('withdrawing 0 balance reverts', async () => {
      await expect(
        wcusdcV3.connect(don).withdraw(ethers.constants.MaxUint256)
      ).to.be.revertedWithCustomError(wcusdcV3, 'BadAmount')
    })

    it('handles complex withdrawal sequence', async () => {
      let bobWithdrawn = bn('0')
      let charlesWithdrawn = bn('0')
      let donWithdrawn = bn('0')

      // charles withdraws SOME
      const firstWithdrawAmt = bn('15000e6')
      charlesWithdrawn = charlesWithdrawn.add(firstWithdrawAmt)
      await wcusdcV3.connect(charles).withdraw(firstWithdrawAmt)
      const newBalanceCharles = await cusdcV3.balanceOf(charles.address)
      expect(newBalanceCharles).to.closeTo(firstWithdrawAmt, 50)

      // don deposits
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, initwusdcAmt, don.address)

      // bob withdraws SOME
      bobWithdrawn = bobWithdrawn.add(bn('12345e6'))
      await wcusdcV3.connect(bob).withdraw(bn('12345e6'))

      // don withdraws SOME
      donWithdrawn = donWithdrawn.add(bn('123e6'))
      await wcusdcV3.connect(don).withdraw(bn('123e6'))

      // charles withdraws ALL
      charlesWithdrawn = charlesWithdrawn.add(await wcusdcV3.underlyingBalanceOf(charles.address))
      await wcusdcV3.connect(charles).withdraw(ethers.constants.MaxUint256)

      // don withdraws ALL
      donWithdrawn = donWithdrawn.add(await wcusdcV3.underlyingBalanceOf(don.address))
      await wcusdcV3.connect(don).withdraw(ethers.constants.MaxUint256)

      // bob withdraws ALL
      bobWithdrawn = bobWithdrawn.add(await wcusdcV3.underlyingBalanceOf(bob.address))
      await wcusdcV3.connect(bob).withdraw(ethers.constants.MaxUint256)

      const bal = await wcusdcV3.balanceOf(bob.address)

      expect(bal).to.closeTo(bn('0'), 10)
      expect(await cusdcV3.balanceOf(bob.address)).to.closeTo(bobWithdrawn, 200)
      expect(await cusdcV3.balanceOf(charles.address)).to.closeTo(charlesWithdrawn, 200)
      expect(await cusdcV3.balanceOf(don.address)).to.closeTo(donWithdrawn, 200)
    })

    it('updates the totalSupply', async () => {
      const totalSupplyBefore = await wcusdcV3.totalSupply()
      const withdrawAmt = bn('15000e6')
      const expectedDiff = await wcusdcV3.convertDynamicToStatic(withdrawAmt)
      await wcusdcV3.connect(bob).withdraw(withdrawAmt)
      // conservative rounding
      expect(await wcusdcV3.totalSupply()).to.be.closeTo(totalSupplyBefore.sub(expectedDiff), 25)
    })
  })

  describe('transfer', () => {
    beforeEach(async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
    })

    it('sets max allowance with approval', async () => {
      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(bn(0))

      // set approve
      await wcusdcV3.connect(bob).allow(don.address, true)

      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(MAX_UINT256)

      // rollback approve
      await wcusdcV3.connect(bob).allow(don.address, false)

      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(bn(0))
    })

    it('does not transfer without approval', async () => {
      await expect(
        wcusdcV3.connect(bob).transferFrom(don.address, bob.address, bn('10000e6'))
      ).to.be.revertedWithCustomError(wcusdcV3, 'Unauthorized')

      // Perform approval
      await wcusdcV3.connect(bob).allow(don.address, true)

      await expect(
        wcusdcV3.connect(don).transferFrom(bob.address, don.address, bn('10000e6'))
      ).to.emit(wcusdcV3, 'Transfer')
    })

    it('transfer from/to zero address revert', async () => {
      await expect(
        wcusdcV3.connect(bob).transfer(ZERO_ADDRESS, bn('100e6'))
      ).to.be.revertedWithCustomError(wcusdcV3, 'ZeroAddress')

      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(
          wcusdcV3.connect(signer).transfer(don.address, bn('100e6'))
        ).to.be.revertedWithCustomError(wcusdcV3, 'ZeroAddress')
      })
    })

    it('performs validation on transfer amount', async () => {
      await expect(
        wcusdcV3.connect(bob).transfer(don.address, bn('40000e6'))
      ).to.be.revertedWithCustomError(wcusdcV3, 'ExceedsBalance')
    })

    it('supports IERC20.approve and performs validations', async () => {
      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(bn(0))
      expect(await wcusdcV3.hasPermission(bob.address, don.address)).to.equal(false)

      // Cannot set approve to the zero address
      await expect(
        wcusdcV3.connect(bob).approve(ZERO_ADDRESS, bn('10000e6'))
      ).to.be.revertedWithCustomError(wcusdcV3, 'ZeroAddress')

      // Can set full allowance with max uint256
      await expect(wcusdcV3.connect(bob).approve(don.address, MAX_UINT256)).to.emit(
        wcusdcV3,
        'Approval'
      )
      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(MAX_UINT256)
      expect(await wcusdcV3.hasPermission(bob.address, don.address)).to.equal(true)

      // Can revert allowance with zero amount
      await expect(wcusdcV3.connect(bob).approve(don.address, bn(0))).to.emit(wcusdcV3, 'Approval')
      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(bn(0))
      expect(await wcusdcV3.hasPermission(bob.address, don.address)).to.equal(false)

      // Any other amount reverts
      await expect(
        wcusdcV3.connect(bob).approve(don.address, bn('10000e6'))
      ).to.be.revertedWithCustomError(wcusdcV3, 'BadAmount')
      expect(await wcusdcV3.allowance(bob.address, don.address)).to.equal(bn(0))
      expect(await wcusdcV3.hasPermission(bob.address, don.address)).to.equal(false)
    })

    it('perform validations on allow', async () => {
      await expect(wcusdcV3.connect(bob).allow(ZERO_ADDRESS, true)).to.be.revertedWithCustomError(
        wcusdcV3,
        'ZeroAddress'
      )

      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(
          wcusdcV3.connect(signer).allow(don.address, true)
        ).to.be.revertedWithCustomError(wcusdcV3, 'ZeroAddress')
      })
    })

    it('updates balances and rewards in sender and receiver', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)

      await enableRewardsAccrual(cusdcV3)
      await advanceTime(1000)

      await wcusdcV3.accrueAccount(don.address)
      await wcusdcV3.accrueAccount(bob.address)

      // Don's rewards accrual should be less than Bob's because he deposited later
      expect(await wcusdcV3.baseTrackingAccrued(don.address)).to.be.lt(
        await wcusdcV3.baseTrackingAccrued(bob.address)
      )
      const bobBal1 = await wcusdcV3.balanceOf(bob.address)
      const donBal1 = await wcusdcV3.balanceOf(don.address)
      await wcusdcV3.connect(bob).transfer(don.address, bn('10000e6'))
      const bobBal2 = await wcusdcV3.balanceOf(bob.address)
      const donBal2 = await wcusdcV3.balanceOf(don.address)

      expect(bobBal2).equal(bobBal1.sub(bn('10000e6')))
      expect(donBal2).equal(donBal1.add(bn('10000e6')))

      await advanceTime(1000)
      await wcusdcV3.accrueAccount(don.address)
      await wcusdcV3.accrueAccount(bob.address)

      expect(await wcusdcV3.baseTrackingAccrued(don.address)).to.be.gt(
        await wcusdcV3.baseTrackingAccrued(bob.address)
      )

      const donsBalance = (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt()
      const bobsBalance = (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt()
      expect(donsBalance).to.be.gt(bobsBalance)
      const totalBalances = donsBalance + bobsBalance

      // Rounding in favor of the Wrapped Token is happening here. Amount is negligible
      expect(totalBalances).to.be.closeTo(await cusdcV3.balanceOf(wcusdcV3.address), 1)
    })

    it('does not update the total supply', async () => {
      const totalSupplyBefore = await wcusdcV3.totalSupply()
      await wcusdcV3.connect(bob).transfer(don.address, bn('10000e6'))
      expect(totalSupplyBefore).to.equal(await wcusdcV3.totalSupply())
    })
  })

  describe('accure / accrueAccount', () => {
    it('accrues internally for the comet', async () => {
      const initAccrueTime = (await cusdcV3.totalsBasic()).lastAccrualTime
      await wcusdcV3.accrue()
      const endAccrueTime = (await cusdcV3.totalsBasic()).lastAccrualTime
      expect(endAccrueTime).gt(initAccrueTime)
    })

    it('accrues rewards over time', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.eq(0)
      await enableRewardsAccrual(cusdcV3)
      await advanceTime(1000)

      await wcusdcV3.accrueAccount(bob.address)
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.be.gt(0)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.eq(
        await cusdcV3.balanceOf(wcusdcV3.address)
      )
    })

    it('does not accrue when accruals are not enabled in Comet', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.eq(0)

      await advanceTime(1000)
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.eq(0)
    })
  })

  describe('underlying balance', () => {
    it('returns the correct amount of decimals', async () => {
      const decimals = await wcusdcV3.decimals()
      expect(decimals).to.equal(6)
    })

    it('returns underlying balance of user which includes revenue', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      const wrappedBalance = await wcusdcV3.balanceOf(bob.address)
      await advanceTime(1000)
      expect(wrappedBalance).to.equal(await wcusdcV3.balanceOf(bob.address))
      // Underlying balance increases over time and is greater than the balance in the wrapped token
      expect(wrappedBalance).to.be.lt(await wcusdcV3.underlyingBalanceOf(bob.address))
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.eq(
        await cusdcV3.balanceOf(wcusdcV3.address)
      )

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)
      await advanceTime(1000)
      const totalBalances = (await wcusdcV3.underlyingBalanceOf(don.address)).add(
        await wcusdcV3.underlyingBalanceOf(bob.address)
      )

      const contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.closeTo(contractBalance, 10)
      expect(totalBalances).to.lte(contractBalance)
    })

    it('returns 0 when user has no balance', async () => {
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.equal(0)
    })

    it('also accrues account in Comet to ensure that global indices are updated', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      const oldTrackingSupplyIndex = (await cusdcV3.totalsBasic()).trackingSupplyIndex

      await advanceTime(1000)
      await wcusdcV3.accrueAccount(bob.address)
      expect(oldTrackingSupplyIndex).to.be.lessThan(
        (await cusdcV3.totalsBasic()).trackingSupplyIndex
      )
    })

    it('matches balance in cUSDCv3', async () => {
      // mint some cusdc to bob
      const amount = bn('20000e6')
      await allocateUSDC(bob.address, amount)
      await usdc.connect(bob).approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3.connect(bob).supply(usdc.address, amount)

      // mint some wcusdc to bob, charles, don
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, amount, bob.address)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charles, amount, charles.address)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, amount, don.address)
      await advanceTime(100000)

      let totalBalances = (await wcusdcV3.underlyingBalanceOf(don.address))
        .add(await wcusdcV3.underlyingBalanceOf(bob.address))
        .add(await wcusdcV3.underlyingBalanceOf(charles.address))
      let contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 10)
      expect(totalBalances).to.be.lte(contractBalance)

      const bobBal = await wcusdcV3.balanceOf(bob.address)
      await wcusdcV3.connect(bob).withdraw(bobBal)
      await wcusdcV3.connect(don).withdraw(bn('10000e6'))

      totalBalances = (await wcusdcV3.underlyingBalanceOf(don.address))
        .add(await wcusdcV3.underlyingBalanceOf(bob.address))
        .add(await wcusdcV3.underlyingBalanceOf(charles.address))
      contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 10)
      expect(totalBalances).to.be.lte(contractBalance)
    })
  })

  describe('exchange rate', () => {
    it('returns the correct exchange rate with 0 balance', async () => {
      const totalsBasic = await cusdcV3.totalsBasic()
      const baseIndexScale = await cusdcV3.baseIndexScale()
      const expectedExchangeRate = totalsBasic.baseSupplyIndex.mul(bn('1e6')).div(baseIndexScale)
      expect(await cusdcV3.balanceOf(wcusdcV3.address)).to.equal(0)
      expect(await wcusdcV3.exchangeRate()).to.be.closeTo(expectedExchangeRate, 5)
    })

    it('returns the correct exchange rate with a positive balance', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      const totalsBasic = await cusdcV3.totalsBasic()
      const baseIndexScale = await cusdcV3.baseIndexScale()
      const expectedExchangeRate = totalsBasic.baseSupplyIndex.mul(bn('1e6')).div(baseIndexScale)
      expect(await wcusdcV3.exchangeRate()).to.equal(expectedExchangeRate)
    })

    it('current exchange rate is a ratio of total underlying balance and total supply', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      const totalSupply = await wcusdcV3.totalSupply()
      const underlyingBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(await wcusdcV3.exchangeRate()).to.equal(
        underlyingBalance.mul(bn('1e6')).div(totalSupply)
      )
    })
  })

  describe('claiming rewards', () => {
    beforeEach(async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
    })

    it('does not claim rewards when user has no permission', async () => {
      await advanceTime(1000)
      await enableRewardsAccrual(cusdcV3)
      await expect(
        wcusdcV3.connect(don).claimTo(bob.address, bob.address)
      ).to.be.revertedWithCustomError(wcusdcV3, 'Unauthorized')

      await wcusdcV3.connect(bob).allow(don.address, true)
      expect(await wcusdcV3.isAllowed(bob.address, don.address)).to.eq(true)
      await expect(wcusdcV3.connect(don).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardsClaimed'
      )
    })

    it('regression test: able to claim rewards even when they are big without overflow', async () => {
      // Nov 28 2023: uint64 math in CusdcV3Wrapper contract results in overflow when COMP rewards are even moderately large

      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await advanceTime(1000)
      await enableRewardsAccrual(cusdcV3, bn('2e18')) // enough to revert on uint64 implementation

      await expect(wcusdcV3.connect(bob).claimRewards()).to.emit(wcusdcV3, 'RewardsClaimed')
      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
    })

    it('claims rewards and sends to claimer (claimTo)', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await advanceTime(1000)
      await enableRewardsAccrual(cusdcV3)

      await expect(wcusdcV3.connect(bob).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardsClaimed'
      )
      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
    })

    it('caps at balance to avoid reverts when claiming rewards (claimTo)', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await advanceTime(1000)
      await enableRewardsAccrual(cusdcV3)

      // Accrue multiple times
      for (let i = 0; i < 10; i++) {
        await advanceTime(1000)
        await wcusdcV3.accrue()
      }

      // Get rewards from Comet
      const cometRewards = await ethers.getContractAt('ICometRewards', REWARDS)
      await whileImpersonating(wcusdcV3.address, async (signer) => {
        await cometRewards
          .connect(signer)
          .claimTo(cusdcV3.address, wcusdcV3.address, wcusdcV3.address, true)
      })

      // Accrue individual account
      await wcusdcV3.accrueAccount(bob.address)

      // Due to rounding, balance is smaller that owed
      const owed = await wcusdcV3.getRewardOwed(bob.address)
      const bal = await compToken.balanceOf(wcusdcV3.address)
      expect(owed).to.be.greaterThan(bal)

      // Should still be able to claimTo (caps at balance)
      const balanceBobPrev = await compToken.balanceOf(bob.address)
      await expect(wcusdcV3.connect(bob).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardsClaimed'
      )

      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(balanceBobPrev)
    })

    it('claims rewards and sends to claimer (claimRewards)', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await advanceTime(1000)
      await enableRewardsAccrual(cusdcV3)

      await expect(wcusdcV3.connect(bob).claimRewards()).to.emit(wcusdcV3, 'RewardsClaimed')
      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
    })

    it('claims rewards by participation', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)

      await enableRewardsAccrual(cusdcV3)
      await advanceTime(1000)

      expect(await compToken.balanceOf(bob.address)).to.equal(0)
      expect(await compToken.balanceOf(don.address)).to.equal(0)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)

      // claim at the same time
      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      await wcusdcV3.connect(don).claimTo(don.address, don.address)
      await network.provider.send('evm_setAutomine', [true])
      await advanceBlocks(1)

      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
      const balanceBob = await compToken.balanceOf(bob.address)
      const balanceDon = await compToken.balanceOf(don.address)
      expect(balanceDon).lessThanOrEqual(balanceBob)
      expect(balanceBob).to.be.closeTo(balanceDon, balanceBob.mul(5).div(1000)) // within 0.5%
    })

    // In this forked block, rewards accrual is not yet enabled in Comet
    // Only applies to Mainnet forks (L1)
    itL1('claims no rewards when rewards accrual is not enabled', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      await advanceTime(1000)
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      expect(await compToken.balanceOf(bob.address)).to.equal(0)
    })

    it('returns reward owed after accrual and claims', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)

      await advanceTime(1000)
      await advanceBlocks(1)

      const bobsReward = await wcusdcV3.getRewardOwed(bob.address)
      const donsReward = await wcusdcV3.getRewardOwed(don.address)

      expect(bobsReward).to.be.greaterThan(donsReward)

      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      expect(await wcusdcV3.getRewardOwed(bob.address)).to.equal(0)

      await advanceTime(1000)
      expect(await wcusdcV3.getRewardOwed(bob.address)).to.be.greaterThan(0)
    })

    it('accrues the account on deposit and withdraw', async () => {
      await enableRewardsAccrual(cusdcV3)
      await advanceTime(1200)
      await advanceBlocks(100)
      const expectedReward = await wcusdcV3.getRewardOwed(bob.address)
      await advanceTime(12)
      await advanceBlocks(1)
      const newExpectedReward = await wcusdcV3.getRewardOwed(bob.address)
      // marginal increase in exepected reward due to time passed
      expect(newExpectedReward).gt(expectedReward)

      await advanceTime(1200)
      await wcusdcV3.connect(bob).withdraw(ethers.constants.MaxUint256)
      const nextExpectedReward = await wcusdcV3.getRewardOwed(bob.address)
      await advanceTime(1200)
      const lastExpectedReward = await wcusdcV3.getRewardOwed(bob.address)
      // expected reward stays the same because account is empty
      expect(lastExpectedReward).to.eq(nextExpectedReward)
    })
  })

  describe('baseTrackingAccrued', () => {
    it('matches baseTrackingAccrued in cUSDCv3 over time', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      let wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(await wcusdcV3.baseTrackingAccrued(bob.address))

      await wcusdcV3.accrueAccount(bob.address)

      wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(await wcusdcV3.baseTrackingAccrued(bob.address))
      expect((await cusdcV3.callStatic.userBasic(wcusdcV3.address)).baseTrackingIndex).to.equal(
        await wcusdcV3.baseTrackingIndex(bob.address)
      )

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charles, bn('20000e6'), charles.address)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)

      await advanceTime(1000)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.accrueAccount(bob.address)
      await wcusdcV3.accrueAccount(charles.address)
      await wcusdcV3.accrueAccount(don.address)
      await advanceBlocks(1)
      await network.provider.send('evm_setAutomine', [true])

      // All users' total accrued rewards in Wrapped cUSDC should closely match Wrapped cUSDC's
      // accrued rewards in cUSDC.
      const bobBTA = await wcusdcV3.baseTrackingAccrued(bob.address)
      const charlesBTA = await wcusdcV3.baseTrackingAccrued(charles.address)
      const donBTA = await wcusdcV3.baseTrackingAccrued(don.address)
      const totalUsersAccrued = bobBTA.add(charlesBTA).add(donBTA)
      wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.be.closeTo(totalUsersAccrued, 5)
    })

    it('matches baseTrackingAccrued in cUSDCv3 after withdrawals', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)

      await advanceTime(1000)
      await wcusdcV3.connect(bob).withdrawTo(bob.address, bn('10000e6'))

      await advanceTime(1000)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.accrueAccount(bob.address)
      await wcusdcV3.accrueAccount(don.address)
      await advanceBlocks(1)
      await network.provider.send('evm_setAutomine', [true])

      // All users' total accrued rewards in Wrapped cUSDC should match Wrapped cUSDC's accrued rewards in cUSDC.
      const totalUsersAccrued = (await wcusdcV3.baseTrackingAccrued(bob.address)).add(
        await wcusdcV3.baseTrackingAccrued(don.address)
      )
      const wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.closeTo(totalUsersAccrued, 10)
      // expect(wrappedTokenAccrued).to.eq(totalUsersAccrued)
    })
  })
})
