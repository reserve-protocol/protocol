import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import hre, { ethers, network } from 'hardhat'
import { useEnv } from '#/utils/env'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceTime, advanceBlocks } from '../../../utils/time'
import { allTests, allocateToken, enableRewardsAccrual, mintWcToken } from './helpers'
import { getForkBlock, COMP, REWARDS, getHolder } from './constants'
import { getResetFork } from '../helpers'
import {
  ERC20Mock,
  CometInterface,
  ICFiatV3Wrapper,
  CFiatV3Wrapper__factory,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MAX_UINT256, ZERO_ADDRESS } from '../../../../common/constants'

for (const curr of allTests) {
  const describeFork =
    useEnv('FORK') && useEnv('FORK_NETWORK') === curr.forkNetwork ? describe : describe.skip

  describeFork(curr.wrapperName, () => {
    let bob: SignerWithAddress
    let charles: SignerWithAddress
    let don: SignerWithAddress
    let token: ERC20Mock
    let wcTokenV3: ICFiatV3Wrapper
    let cTokenV3: CometInterface

    let chainId: number

    before(async () => {
      await getResetFork(getForkBlock(curr.tokenName))()

      chainId = await getChainId(hre)

      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[, bob, charles, don] = await ethers.getSigners()
      ;({ token, wcTokenV3, cTokenV3 } = await loadFixture(curr.fix))
    })

    it('reverts if deployed with a 0 address', async () => {
      const CTokenV3WrapperFactory = <CFiatV3Wrapper__factory>(
        await ethers.getContractFactory('CFiatV3Wrapper')
      )

      // TODO there is a chai limitation that cannot catch custom errors during deployment
      await expect(
        CTokenV3WrapperFactory.deploy(
          ZERO_ADDRESS,
          REWARDS,
          COMP,
          curr.wrapperName,
          curr.wrapperSymbol,
          fp('1')
        )
      ).to.be.reverted
    })

    it('configuration/state', async () => {
      expect(await wcTokenV3.symbol()).to.equal(curr.wrapperSymbol)
      expect(await wcTokenV3.name()).to.equal(curr.wrapperName)
      expect(await wcTokenV3.totalSupply()).to.equal(bn(0))

      expect(await wcTokenV3.underlyingComet()).to.equal(cTokenV3.address)
      expect(await wcTokenV3.rewardERC20()).to.equal(COMP)
    })

    describe('deposit', () => {
      const amount = bn('20000e6')

      beforeEach(async () => {
        await allocateToken(bob.address, amount, getHolder(await token.symbol()), token.address)
        await token.connect(bob).approve(cTokenV3.address, ethers.constants.MaxUint256)
        await cTokenV3.connect(bob).supply(token.address, amount)
        await cTokenV3.connect(bob).allow(wcTokenV3.address, true)
      })

      it('deposit', async () => {
        const expectedAmount = await wcTokenV3.convertDynamicToStatic(
          await cTokenV3.balanceOf(bob.address)
        )
        await wcTokenV3.connect(bob).deposit(ethers.constants.MaxUint256)
        expect(await cTokenV3.balanceOf(bob.address)).to.equal(0)
        expect(await token.balanceOf(bob.address)).to.equal(0)
        expect(await wcTokenV3.balanceOf(bob.address)).to.eq(expectedAmount)
      })

      it('deposits to own account', async () => {
        const expectedAmount = await wcTokenV3.convertDynamicToStatic(
          await cTokenV3.balanceOf(bob.address)
        )
        await wcTokenV3.connect(bob).depositTo(bob.address, ethers.constants.MaxUint256)
        expect(await cTokenV3.balanceOf(bob.address)).to.equal(0)
        expect(await token.balanceOf(bob.address)).to.equal(0)
        expect(await wcTokenV3.balanceOf(bob.address)).to.eq(expectedAmount)
      })

      it('deposits for someone else', async () => {
        const expectedAmount = await wcTokenV3.convertDynamicToStatic(
          await cTokenV3.balanceOf(bob.address)
        )
        await wcTokenV3.connect(bob).depositTo(don.address, ethers.constants.MaxUint256)
        expect(await wcTokenV3.balanceOf(bob.address)).to.eq(0)
        expect(await wcTokenV3.balanceOf(don.address)).to.eq(expectedAmount)
      })

      it('checks for correct approval on deposit - regression test', async () => {
        await expect(
          wcTokenV3
            .connect(don)
            .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
        ).revertedWithCustomError(wcTokenV3, 'Unauthorized')

        // Provide approval on the wrapper
        await wcTokenV3.connect(bob).allow(don.address, true)

        const expectedAmount = await wcTokenV3.convertDynamicToStatic(
          await cTokenV3.balanceOf(bob.address)
        )

        // This should fail even when bob approved wcTokenV3 to spend his tokens,
        // because there is no explicit approval of cTokenV3 from bob to don, only
        // approval on the wrapper
        await expect(
          wcTokenV3
            .connect(don)
            .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(cTokenV3, 'Unauthorized')

        // Add explicit approval of cTokenV3 and retry
        await cTokenV3.connect(bob).allow(don.address, true)
        await wcTokenV3
          .connect(don)
          .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)

        expect(await wcTokenV3.balanceOf(bob.address)).to.eq(0)
        expect(await wcTokenV3.balanceOf(charles.address)).to.eq(expectedAmount)
      })

      it('deposits from a different account', async () => {
        expect(await wcTokenV3.balanceOf(charles.address)).to.eq(0)
        await expect(
          wcTokenV3
            .connect(don)
            .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
        ).revertedWithCustomError(wcTokenV3, 'Unauthorized')

        // Approval has to be on cTokenV3, not the wrapper
        await cTokenV3.connect(bob).allow(don.address, true)
        const expectedAmount = await wcTokenV3.convertDynamicToStatic(
          await cTokenV3.balanceOf(bob.address)
        )
        await wcTokenV3
          .connect(don)
          .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)

        expect(await wcTokenV3.balanceOf(bob.address)).to.eq(0)
        expect(await wcTokenV3.balanceOf(charles.address)).to.eq(expectedAmount)
      })

      it('deposits less than available cToken', async () => {
        const depositAmount = bn('10000e6')
        const expectedAmount = await wcTokenV3.convertDynamicToStatic(depositAmount)
        await wcTokenV3.connect(bob).depositTo(bob.address, depositAmount)
        expect(await cTokenV3.balanceOf(bob.address)).to.be.closeTo(depositAmount, 100)
        expect(await token.balanceOf(bob.address)).to.equal(0)
        expect(await wcTokenV3.balanceOf(bob.address)).to.closeTo(expectedAmount, 100)
      })

      it('user that deposits must have same baseTrackingIndex as this Token in Comet', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, amount, bob.address)
        expect((await cTokenV3.callStatic.userBasic(wcTokenV3.address)).baseTrackingIndex).to.equal(
          await wcTokenV3.baseTrackingIndex(bob.address)
        )
      })

      it('multiple deposits lead to accurate balances', async () => {
        let expectedAmount = await wcTokenV3.convertDynamicToStatic(bn('10000e6'))
        await wcTokenV3.connect(bob).depositTo(bob.address, bn('10000e6'))
        await advanceTime(1000)
        expectedAmount = expectedAmount.add(await wcTokenV3.convertDynamicToStatic(bn('10000e6')))
        await wcTokenV3.connect(bob).depositTo(bob.address, bn('10000e6'))

        // The more wcTokenV3 is minted, the higher its value is relative to cTokenV3.
        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.be.gt(amount)
        expect(await wcTokenV3.balanceOf(bob.address)).to.closeTo(expectedAmount, 100)

        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.be.closeTo(
          await cTokenV3.balanceOf(wcTokenV3.address),
          1
        )
      })

      it('updates the totalSupply', async () => {
        const totalSupplyBefore = await wcTokenV3.totalSupply()
        const expectedAmount = await wcTokenV3.convertDynamicToStatic(
          await cTokenV3.balanceOf(bob.address)
        )
        await wcTokenV3.connect(bob).deposit(ethers.constants.MaxUint256)
        expect(await wcTokenV3.totalSupply()).to.equal(totalSupplyBefore.add(expectedAmount))
      })

      it('deposit 0 reverts', async () => {
        await expect(wcTokenV3.connect(bob).deposit(0)).to.be.revertedWithCustomError(
          wcTokenV3,
          'BadAmount'
        )
      })

      it('depositing 0 balance reverts', async () => {
        await cTokenV3.connect(bob).transfer(charles.address, ethers.constants.MaxUint256)
        await expect(
          wcTokenV3.connect(bob).deposit(ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(wcTokenV3, 'BadAmount')
      })

      it('desposit to zero address reverts', async () => {
        await expect(
          wcTokenV3.connect(bob).depositTo(ZERO_ADDRESS, ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(wcTokenV3, 'ZeroAddress')
      })
    })

    describe('withdraw', () => {
      const initwtokenAmt = bn('20000e6')

      beforeEach(async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, initwtokenAmt, bob.address)
        await mintWcToken(token, cTokenV3, wcTokenV3, charles, initwtokenAmt, charles.address)
      })

      it('withdraws to own account', async () => {
        // bob withdraws ALL
        const expectedAmountBob = await wcTokenV3.underlyingBalanceOf(bob.address)
        await wcTokenV3.connect(bob).withdraw(ethers.constants.MaxUint256)
        const bal = await wcTokenV3.balanceOf(bob.address)
        expect(bal).to.closeTo(bn('0'), 10)
        expect(await cTokenV3.balanceOf(bob.address)).to.closeTo(expectedAmountBob, 80)
      })

      it('withdraws to a different account', async () => {
        const expectedAmount = await wcTokenV3.underlyingBalanceOf(bob.address)
        await wcTokenV3.connect(bob).withdrawTo(don.address, ethers.constants.MaxUint256)
        expect(await cTokenV3.balanceOf(don.address)).to.closeTo(expectedAmount, 100)
        expect(await wcTokenV3.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
      })

      it('withdraws from a different account', async () => {
        const withdrawAmount = await wcTokenV3.underlyingBalanceOf(bob.address)
        await expect(
          wcTokenV3.connect(charles).withdrawFrom(bob.address, don.address, withdrawAmount)
        ).to.be.revertedWithCustomError(wcTokenV3, 'Unauthorized')

        await wcTokenV3.connect(bob).allow(charles.address, true)
        await wcTokenV3.connect(charles).withdrawFrom(bob.address, don.address, withdrawAmount)

        expect(await cTokenV3.balanceOf(don.address)).to.closeTo(withdrawAmount, 100)
        expect(await cTokenV3.balanceOf(charles.address)).to.closeTo(bn('0'), 50)

        expect(await wcTokenV3.balanceOf(bob.address)).to.closeTo(bn(0), 150)
      })

      it('withdraws all underlying balance via multiple withdrawals', async () => {
        await advanceTime(1000)
        const initialBalance = await wcTokenV3.underlyingBalanceOf(bob.address)
        const withdrawAmt = bn('10000e6')
        await wcTokenV3.connect(bob).withdraw(withdrawAmt)
        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.closeTo(
          initialBalance.sub(withdrawAmt),
          50
        )
        await advanceTime(1000)
        await wcTokenV3.connect(bob).withdraw(ethers.constants.MaxUint256)
        expect(await wcTokenV3.balanceOf(bob.address)).to.closeTo(bn('0'), 10)
        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.closeTo(bn('0'), 10)
      })

      it('withdrawing 0 reverts', async () => {
        const initialBalance = await wcTokenV3.balanceOf(bob.address)
        await expect(wcTokenV3.connect(bob).withdraw(0)).to.be.revertedWithCustomError(
          wcTokenV3,
          'BadAmount'
        )
        expect(await wcTokenV3.balanceOf(bob.address)).to.equal(initialBalance)
      })

      it('withdrawing 0 balance reverts', async () => {
        await expect(
          wcTokenV3.connect(don).withdraw(ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(wcTokenV3, 'BadAmount')
      })

      it('handles complex withdrawal sequence', async () => {
        let bobWithdrawn = bn('0')
        let charlesWithdrawn = bn('0')
        let donWithdrawn = bn('0')

        // charles withdraws SOME
        const firstWithdrawAmt = bn('15000e6')
        charlesWithdrawn = charlesWithdrawn.add(firstWithdrawAmt)
        await wcTokenV3.connect(charles).withdraw(firstWithdrawAmt)
        const newBalanceCharles = await cTokenV3.balanceOf(charles.address)
        expect(newBalanceCharles).to.closeTo(firstWithdrawAmt, 50)

        // don deposits
        await mintWcToken(token, cTokenV3, wcTokenV3, don, initwtokenAmt, don.address)

        // bob withdraws SOME
        bobWithdrawn = bobWithdrawn.add(bn('12345e6'))
        await wcTokenV3.connect(bob).withdraw(bn('12345e6'))

        // don withdraws SOME
        donWithdrawn = donWithdrawn.add(bn('123e6'))
        await wcTokenV3.connect(don).withdraw(bn('123e6'))

        // charles withdraws ALL
        charlesWithdrawn = charlesWithdrawn.add(
          await wcTokenV3.underlyingBalanceOf(charles.address)
        )
        await wcTokenV3.connect(charles).withdraw(ethers.constants.MaxUint256)

        // don withdraws ALL
        donWithdrawn = donWithdrawn.add(await wcTokenV3.underlyingBalanceOf(don.address))
        await wcTokenV3.connect(don).withdraw(ethers.constants.MaxUint256)

        // bob withdraws ALL
        bobWithdrawn = bobWithdrawn.add(await wcTokenV3.underlyingBalanceOf(bob.address))
        await wcTokenV3.connect(bob).withdraw(ethers.constants.MaxUint256)

        const bal = await wcTokenV3.balanceOf(bob.address)

        expect(bal).to.closeTo(bn('0'), 10)
        expect(await cTokenV3.balanceOf(bob.address)).to.closeTo(bobWithdrawn, 500)
        expect(await cTokenV3.balanceOf(charles.address)).to.closeTo(charlesWithdrawn, 500)
        expect(await cTokenV3.balanceOf(don.address)).to.closeTo(donWithdrawn, 500)
      })

      it('updates the totalSupply', async () => {
        const totalSupplyBefore = await wcTokenV3.totalSupply()
        const withdrawAmt = bn('15000e6')
        const expectedDiff = await wcTokenV3.convertDynamicToStatic(withdrawAmt)
        await wcTokenV3.connect(bob).withdraw(withdrawAmt)
        // conservative rounding
        expect(await wcTokenV3.totalSupply()).to.be.closeTo(totalSupplyBefore.sub(expectedDiff), 25)
      })
    })

    describe('transfer', () => {
      beforeEach(async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
      })

      it('sets max allowance with approval', async () => {
        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(bn(0))

        // set approve
        await wcTokenV3.connect(bob).allow(don.address, true)

        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(MAX_UINT256)

        // rollback approve
        await wcTokenV3.connect(bob).allow(don.address, false)

        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(bn(0))
      })

      it('does not transfer without approval', async () => {
        await expect(
          wcTokenV3.connect(bob).transferFrom(don.address, bob.address, bn('10000e6'))
        ).to.be.revertedWithCustomError(wcTokenV3, 'Unauthorized')

        // Perform approval
        await wcTokenV3.connect(bob).allow(don.address, true)

        await expect(
          wcTokenV3.connect(don).transferFrom(bob.address, don.address, bn('10000e6'))
        ).to.emit(wcTokenV3, 'Transfer')
      })

      it('transfer from/to zero address revert', async () => {
        await expect(
          wcTokenV3.connect(bob).transfer(ZERO_ADDRESS, bn('100e6'))
        ).to.be.revertedWithCustomError(wcTokenV3, 'ZeroAddress')

        await whileImpersonating(ZERO_ADDRESS, async (signer) => {
          await expect(
            wcTokenV3.connect(signer).transfer(don.address, bn('100e6'))
          ).to.be.revertedWithCustomError(wcTokenV3, 'ZeroAddress')
        })
      })

      it('performs validation on transfer amount', async () => {
        await expect(
          wcTokenV3.connect(bob).transfer(don.address, bn('40000e6'))
        ).to.be.revertedWithCustomError(wcTokenV3, 'ExceedsBalance')
      })

      it('supports IERC20.approve and performs validations', async () => {
        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(bn(0))
        expect(await wcTokenV3.hasPermission(bob.address, don.address)).to.equal(false)

        // Cannot set approve to the zero address
        await expect(
          wcTokenV3.connect(bob).approve(ZERO_ADDRESS, bn('10000e6'))
        ).to.be.revertedWithCustomError(wcTokenV3, 'ZeroAddress')

        // Can set full allowance with max uint256
        await expect(wcTokenV3.connect(bob).approve(don.address, MAX_UINT256)).to.emit(
          wcTokenV3,
          'Approval'
        )
        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(MAX_UINT256)
        expect(await wcTokenV3.hasPermission(bob.address, don.address)).to.equal(true)

        // Can revert allowance with zero amount
        await expect(wcTokenV3.connect(bob).approve(don.address, bn(0))).to.emit(
          wcTokenV3,
          'Approval'
        )
        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(bn(0))
        expect(await wcTokenV3.hasPermission(bob.address, don.address)).to.equal(false)

        // Any other amount reverts
        await expect(
          wcTokenV3.connect(bob).approve(don.address, bn('10000e6'))
        ).to.be.revertedWithCustomError(wcTokenV3, 'BadAmount')
        expect(await wcTokenV3.allowance(bob.address, don.address)).to.equal(bn(0))
        expect(await wcTokenV3.hasPermission(bob.address, don.address)).to.equal(false)
      })

      it('perform validations on allow', async () => {
        await expect(
          wcTokenV3.connect(bob).allow(ZERO_ADDRESS, true)
        ).to.be.revertedWithCustomError(wcTokenV3, 'ZeroAddress')

        await whileImpersonating(ZERO_ADDRESS, async (signer) => {
          await expect(
            wcTokenV3.connect(signer).allow(don.address, true)
          ).to.be.revertedWithCustomError(wcTokenV3, 'ZeroAddress')
        })
      })

      it('updates balances and rewards in sender and receiver', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, don, bn('20000e6'), don.address)

        await enableRewardsAccrual(cTokenV3)
        await advanceTime(1000)

        await wcTokenV3.accrueAccount(don.address)
        await wcTokenV3.accrueAccount(bob.address)

        // Don's rewards accrual should be less than Bob's because he deposited later
        expect(await wcTokenV3.baseTrackingAccrued(don.address)).to.be.lt(
          await wcTokenV3.baseTrackingAccrued(bob.address)
        )
        const bobBal1 = await wcTokenV3.balanceOf(bob.address)
        const donBal1 = await wcTokenV3.balanceOf(don.address)
        await wcTokenV3.connect(bob).transfer(don.address, bn('10000e6'))
        const bobBal2 = await wcTokenV3.balanceOf(bob.address)
        const donBal2 = await wcTokenV3.balanceOf(don.address)

        expect(bobBal2).equal(bobBal1.sub(bn('10000e6')))
        expect(donBal2).equal(donBal1.add(bn('10000e6')))

        await advanceTime(1000)
        await wcTokenV3.accrueAccount(don.address)
        await wcTokenV3.accrueAccount(bob.address)

        expect(await wcTokenV3.baseTrackingAccrued(don.address)).to.be.gt(
          await wcTokenV3.baseTrackingAccrued(bob.address)
        )

        const donsBalance = (await wcTokenV3.underlyingBalanceOf(don.address)).toBigInt()
        const bobsBalance = (await wcTokenV3.underlyingBalanceOf(bob.address)).toBigInt()
        expect(donsBalance).to.be.gt(bobsBalance)
        const totalBalances = donsBalance + bobsBalance

        // Rounding in favor of the Wrapped Token is happening here. Amount is negligible
        expect(totalBalances).to.be.closeTo(await cTokenV3.balanceOf(wcTokenV3.address), 1)
      })

      it('does not update the total supply', async () => {
        const totalSupplyBefore = await wcTokenV3.totalSupply()
        await wcTokenV3.connect(bob).transfer(don.address, bn('10000e6'))
        expect(totalSupplyBefore).to.equal(await wcTokenV3.totalSupply())
      })
    })

    describe('accure / accrueAccount', () => {
      it('accrues internally for the comet', async () => {
        const initAccrueTime = (await cTokenV3.totalsBasic()).lastAccrualTime
        await wcTokenV3.accrue()
        const endAccrueTime = (await cTokenV3.totalsBasic()).lastAccrualTime
        expect(endAccrueTime).gt(initAccrueTime)
      })

      it('accrues rewards over time', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        expect(await wcTokenV3.baseTrackingAccrued(bob.address)).to.eq(0)
        await enableRewardsAccrual(cTokenV3)
        await advanceTime(1000)

        await wcTokenV3.accrueAccount(bob.address)
        expect(await wcTokenV3.baseTrackingAccrued(bob.address)).to.be.gt(0)
        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.eq(
          await cTokenV3.balanceOf(wcTokenV3.address)
        )
      })

      it('does not accrue when accruals are not enabled in Comet', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        expect(await wcTokenV3.baseTrackingAccrued(bob.address)).to.eq(0)

        await advanceTime(1000)
        expect(await wcTokenV3.baseTrackingAccrued(bob.address)).to.eq(0)
      })
    })

    describe('underlying balance', () => {
      it('returns the correct amount of decimals', async () => {
        const decimals = await wcTokenV3.decimals()
        expect(decimals).to.equal(6)
      })

      it('returns underlying balance of user which includes revenue', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        const wrappedBalance = await wcTokenV3.balanceOf(bob.address)
        await advanceTime(1000)
        expect(wrappedBalance).to.equal(await wcTokenV3.balanceOf(bob.address))
        // Underlying balance increases over time and is greater than the balance in the wrapped token
        expect(wrappedBalance).to.be.lt(await wcTokenV3.underlyingBalanceOf(bob.address))
        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.eq(
          await cTokenV3.balanceOf(wcTokenV3.address)
        )

        await mintWcToken(token, cTokenV3, wcTokenV3, don, bn('20000e6'), don.address)
        await advanceTime(1000)
        const totalBalances = (await wcTokenV3.underlyingBalanceOf(don.address)).add(
          await wcTokenV3.underlyingBalanceOf(bob.address)
        )

        const contractBalance = await cTokenV3.balanceOf(wcTokenV3.address)
        expect(totalBalances).to.closeTo(contractBalance, 10)
        expect(totalBalances).to.lte(contractBalance)
      })

      it('returns 0 when user has no balance', async () => {
        expect(await wcTokenV3.underlyingBalanceOf(bob.address)).to.equal(0)
      })

      it('also accrues account in Comet to ensure that global indices are updated', async () => {
        await enableRewardsAccrual(cTokenV3)
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        const oldTrackingSupplyIndex = (await cTokenV3.totalsBasic()).trackingSupplyIndex

        await advanceTime(1000)
        await wcTokenV3.accrueAccount(bob.address)
        expect(oldTrackingSupplyIndex).to.be.lessThan(
          (await cTokenV3.totalsBasic()).trackingSupplyIndex
        )
      })

      it('matches balance in cTokenV3', async () => {
        // mint some ctoken to bob
        const amount = bn('20000e6')
        await allocateToken(bob.address, amount, getHolder(await token.symbol()), token.address)
        await token.connect(bob).approve(cTokenV3.address, ethers.constants.MaxUint256)
        await cTokenV3.connect(bob).supply(token.address, amount)

        // mint some wctoken to bob, charles, don
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, amount, bob.address)
        await mintWcToken(token, cTokenV3, wcTokenV3, charles, amount, charles.address)
        await mintWcToken(token, cTokenV3, wcTokenV3, don, amount, don.address)
        await advanceTime(100000)

        let totalBalances = (await wcTokenV3.underlyingBalanceOf(don.address))
          .add(await wcTokenV3.underlyingBalanceOf(bob.address))
          .add(await wcTokenV3.underlyingBalanceOf(charles.address))
        let contractBalance = await cTokenV3.balanceOf(wcTokenV3.address)
        expect(totalBalances).to.be.closeTo(contractBalance, 10)
        expect(totalBalances).to.be.lte(contractBalance)

        const bobBal = await wcTokenV3.balanceOf(bob.address)
        await wcTokenV3.connect(bob).withdraw(bobBal)
        await wcTokenV3.connect(don).withdraw(bn('10000e6'))

        totalBalances = (await wcTokenV3.underlyingBalanceOf(don.address))
          .add(await wcTokenV3.underlyingBalanceOf(bob.address))
          .add(await wcTokenV3.underlyingBalanceOf(charles.address))
        contractBalance = await cTokenV3.balanceOf(wcTokenV3.address)
        expect(totalBalances).to.be.closeTo(contractBalance, 10)
        expect(totalBalances).to.be.lte(contractBalance)
      })
    })

    describe('exchange rate', () => {
      it('returns the correct exchange rate with 0 balance', async () => {
        const totalsBasic = await cTokenV3.totalsBasic()
        const baseIndexScale = await cTokenV3.baseIndexScale()
        const expectedExchangeRate = totalsBasic.baseSupplyIndex.mul(bn('1e6')).div(baseIndexScale)
        expect(await cTokenV3.balanceOf(wcTokenV3.address)).to.equal(0)
        expect(await wcTokenV3.exchangeRate()).to.be.closeTo(expectedExchangeRate, 10)
      })

      it('returns the correct exchange rate with a positive balance', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        const totalsBasic = await cTokenV3.totalsBasic()
        const baseIndexScale = await cTokenV3.baseIndexScale()
        const expectedExchangeRate = totalsBasic.baseSupplyIndex.mul(bn('1e6')).div(baseIndexScale)
        expect(await wcTokenV3.exchangeRate()).to.equal(expectedExchangeRate)
      })

      it('current exchange rate is a ratio of total underlying balance and total supply', async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        const totalSupply = await wcTokenV3.totalSupply()
        const underlyingBalance = await cTokenV3.balanceOf(wcTokenV3.address)
        expect(await wcTokenV3.exchangeRate()).to.equal(
          underlyingBalance.mul(bn('1e6')).div(totalSupply)
        )
      })
    })

    describe('claiming rewards', () => {
      beforeEach(async () => {
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
      })

      it('does not claim rewards when user has no permission', async () => {
        await advanceTime(1000)
        await enableRewardsAccrual(cTokenV3)
        await expect(
          wcTokenV3.connect(don).claimTo(bob.address, bob.address)
        ).to.be.revertedWithCustomError(wcTokenV3, 'Unauthorized')

        await wcTokenV3.connect(bob).allow(don.address, true)
        expect(await wcTokenV3.isAllowed(bob.address, don.address)).to.eq(true)
        await expect(wcTokenV3.connect(don).claimTo(bob.address, bob.address)).to.emit(
          wcTokenV3,
          'RewardsClaimed'
        )
      })

      it('regression test: able to claim rewards even when they are big without overflow', async () => {
        // Nov 28 2023: uint64 math in CFiatV3Wrapper contract results in overflow when COMP rewards are even moderately large

        const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
        expect(await compToken.balanceOf(wcTokenV3.address)).to.equal(0)
        await advanceTime(1000)
        await enableRewardsAccrual(cTokenV3, bn('2e18')) // enough to revert on uint64 implementation

        await expect(wcTokenV3.connect(bob).claimRewards()).to.emit(wcTokenV3, 'RewardsClaimed')
        expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
      })

      it('claims rewards and sends to claimer (claimTo)', async () => {
        const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
        expect(await compToken.balanceOf(wcTokenV3.address)).to.equal(0)
        await advanceTime(1000)
        await enableRewardsAccrual(cTokenV3)

        await expect(wcTokenV3.connect(bob).claimTo(bob.address, bob.address)).to.emit(
          wcTokenV3,
          'RewardsClaimed'
        )
        expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
      })

      it('caps at balance to avoid reverts when claiming rewards (claimTo)', async () => {
        const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
        expect(await compToken.balanceOf(wcTokenV3.address)).to.equal(0)
        await advanceTime(1000)
        await enableRewardsAccrual(cTokenV3)

        // Accrue multiple times
        for (let i = 0; i < 10; i++) {
          await advanceTime(1000)
          await wcTokenV3.accrue()
        }

        // Get rewards from Comet
        const cometRewards = await ethers.getContractAt('ICometRewards', REWARDS)
        await whileImpersonating(wcTokenV3.address, async (signer) => {
          await cometRewards
            .connect(signer)
            .claimTo(cTokenV3.address, wcTokenV3.address, wcTokenV3.address, true)
        })

        // Accrue individual account
        await wcTokenV3.accrueAccount(bob.address)

        // Due to rounding, balance is smaller that owed
        const owed = await wcTokenV3.getRewardOwed(bob.address)
        const bal = await compToken.balanceOf(wcTokenV3.address)
        expect(owed).to.be.greaterThan(bal)

        // Should still be able to claimTo (caps at balance)
        const balanceBobPrev = await compToken.balanceOf(bob.address)
        await expect(wcTokenV3.connect(bob).claimTo(bob.address, bob.address)).to.emit(
          wcTokenV3,
          'RewardsClaimed'
        )

        expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(balanceBobPrev)
      })

      it('claims rewards and sends to claimer (claimRewards)', async () => {
        const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
        expect(await compToken.balanceOf(wcTokenV3.address)).to.equal(0)
        await advanceTime(1000)
        await enableRewardsAccrual(cTokenV3)

        await expect(wcTokenV3.connect(bob).claimRewards()).to.emit(wcTokenV3, 'RewardsClaimed')
        expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
      })

      it('claims rewards by participation', async () => {
        const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

        await mintWcToken(token, cTokenV3, wcTokenV3, don, bn('20000e6'), don.address)

        await enableRewardsAccrual(cTokenV3)
        await advanceTime(1000)

        expect(await compToken.balanceOf(bob.address)).to.equal(0)
        expect(await compToken.balanceOf(don.address)).to.equal(0)
        expect(await compToken.balanceOf(wcTokenV3.address)).to.equal(0)

        // claim at the same time
        await network.provider.send('evm_setAutomine', [false])
        await wcTokenV3.connect(bob).claimTo(bob.address, bob.address)
        await wcTokenV3.connect(don).claimTo(don.address, don.address)
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
      it('claims no rewards when rewards accrual is not enabled', async () => {
        await enableRewardsAccrual(cTokenV3, bn(0))

        const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
        await advanceTime(1000)
        await wcTokenV3.connect(bob).claimTo(bob.address, bob.address)
        expect(await compToken.balanceOf(bob.address)).to.equal(0)
      })

      it('returns reward owed after accrual and claims', async () => {
        await enableRewardsAccrual(cTokenV3)
        await mintWcToken(token, cTokenV3, wcTokenV3, don, bn('20000e6'), don.address)

        await advanceTime(1000)
        await advanceBlocks(1)

        const bobsReward = await wcTokenV3.getRewardOwed(bob.address)
        const donsReward = await wcTokenV3.getRewardOwed(don.address)

        expect(bobsReward).to.be.greaterThan(donsReward)

        await wcTokenV3.connect(bob).claimTo(bob.address, bob.address)
        expect(await wcTokenV3.getRewardOwed(bob.address)).to.equal(0)

        await advanceTime(1000)
        expect(await wcTokenV3.getRewardOwed(bob.address)).to.be.greaterThan(0)
      })

      it('accrues the account on deposit and withdraw', async () => {
        await enableRewardsAccrual(cTokenV3)
        await advanceTime(1200)
        await advanceBlocks(100)
        const expectedReward = await wcTokenV3.getRewardOwed(bob.address)
        await advanceTime(12)
        await advanceBlocks(1)
        const newExpectedReward = await wcTokenV3.getRewardOwed(bob.address)
        // marginal increase in exepected reward due to time passed
        expect(newExpectedReward).gt(expectedReward)

        await advanceTime(1200)
        await wcTokenV3.connect(bob).withdraw(ethers.constants.MaxUint256)
        const nextExpectedReward = await wcTokenV3.getRewardOwed(bob.address)
        await advanceTime(1200)
        const lastExpectedReward = await wcTokenV3.getRewardOwed(bob.address)
        // expected reward stays the same because account is empty
        expect(lastExpectedReward).to.eq(nextExpectedReward)
      })
    })

    describe('baseTrackingAccrued', () => {
      it('matches baseTrackingAccrued in cTokenV3 over time', async () => {
        await enableRewardsAccrual(cTokenV3)
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        let wrappedTokenAccrued = await cTokenV3.baseTrackingAccrued(wcTokenV3.address)
        expect(wrappedTokenAccrued).to.equal(await wcTokenV3.baseTrackingAccrued(bob.address))

        await wcTokenV3.accrueAccount(bob.address)

        wrappedTokenAccrued = await cTokenV3.baseTrackingAccrued(wcTokenV3.address)
        expect(wrappedTokenAccrued).to.equal(await wcTokenV3.baseTrackingAccrued(bob.address))
        expect((await cTokenV3.callStatic.userBasic(wcTokenV3.address)).baseTrackingIndex).to.equal(
          await wcTokenV3.baseTrackingIndex(bob.address)
        )

        await mintWcToken(token, cTokenV3, wcTokenV3, charles, bn('20000e6'), charles.address)
        await mintWcToken(token, cTokenV3, wcTokenV3, don, bn('20000e6'), don.address)

        await advanceTime(1000)

        await network.provider.send('evm_setAutomine', [false])
        await wcTokenV3.accrueAccount(bob.address)
        await wcTokenV3.accrueAccount(charles.address)
        await wcTokenV3.accrueAccount(don.address)
        await advanceBlocks(1)
        await network.provider.send('evm_setAutomine', [true])

        // All users' total accrued rewards in Wrapped cToken should closely match Wrapped cToken's
        // accrued rewards in cToken
        const bobBTA = await wcTokenV3.baseTrackingAccrued(bob.address)
        const charlesBTA = await wcTokenV3.baseTrackingAccrued(charles.address)
        const donBTA = await wcTokenV3.baseTrackingAccrued(don.address)
        const totalUsersAccrued = bobBTA.add(charlesBTA).add(donBTA)
        wrappedTokenAccrued = await cTokenV3.baseTrackingAccrued(wcTokenV3.address)
        expect(wrappedTokenAccrued).to.be.closeTo(totalUsersAccrued, 5)
      })

      it('matches baseTrackingAccrued in cTokenV3 after withdrawals', async () => {
        await enableRewardsAccrual(cTokenV3)
        await mintWcToken(token, cTokenV3, wcTokenV3, bob, bn('20000e6'), bob.address)
        await mintWcToken(token, cTokenV3, wcTokenV3, don, bn('20000e6'), don.address)

        await advanceTime(1000)
        await wcTokenV3.connect(bob).withdrawTo(bob.address, bn('10000e6'))

        await advanceTime(1000)

        await network.provider.send('evm_setAutomine', [false])
        await wcTokenV3.accrueAccount(bob.address)
        await wcTokenV3.accrueAccount(don.address)
        await advanceBlocks(1)
        await network.provider.send('evm_setAutomine', [true])

        // All users' total accrued rewards in Wrapped cToken should match Wrapped cToken's accrued rewards in cToken.
        const totalUsersAccrued = (await wcTokenV3.baseTrackingAccrued(bob.address)).add(
          await wcTokenV3.baseTrackingAccrued(don.address)
        )
        const wrappedTokenAccrued = await cTokenV3.baseTrackingAccrued(wcTokenV3.address)
        expect(wrappedTokenAccrued).to.closeTo(totalUsersAccrued, 10)
        // expect(wrappedTokenAccrued).to.eq(totalUsersAccrued)
      })
    })
  })
}
