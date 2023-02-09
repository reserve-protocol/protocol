import { expect } from 'chai'
import { Wallet, BigNumberish } from 'ethers'
import hre, { ethers, network, waffle } from 'hardhat'
import { useEnv } from '#/utils/env'
import { advanceTime, advanceBlocks, setNextBlockTimestamp, getLatestBlockTimestamp } from '../../../utils/time'
import { allocateUSDC, enableRewardsAccrual, mintWcUSDC, makewCSUDC, resetFork } from './helpers'
import { COMP } from './constants'
import { ERC20Mock, CometInterface, CusdcV3Wrapper } from '../../../../typechain'
import { bn } from '../../../../common/numbers'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('Wrapped CUSDCv3', () => {
  let bob: SignerWithAddress
  let charles: SignerWithAddress
  let don: SignerWithAddress
  let usdc: ERC20Mock
  let wcusdcV3: CusdcV3Wrapper
  let cusdcV3: CometInterface

  let wallet: Wallet
  let chainId: number

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before(async () => {
    await resetFork()
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[, bob, charles, don] = await ethers.getSigners()
    ;({ usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC))
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
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(await cusdcV3.balanceOf(bob.address))
      await wcusdcV3.connect(bob).deposit(ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(expectedAmount)
    })

    it('deposits to own account', async () => {
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(await cusdcV3.balanceOf(bob.address))
      await wcusdcV3.connect(bob).depositTo(bob.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(expectedAmount)
    })

    it('deposits for someone else', async () => {
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(await cusdcV3.balanceOf(bob.address))
      await wcusdcV3.connect(bob).depositTo(don.address, ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(don.address)).to.eq(expectedAmount)
    })

    it('deposits from a different account', async () => {
      expect(await wcusdcV3.balanceOf(charles.address)).to.eq(0)
      await expect(
        wcusdcV3.connect(don).depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
      ).revertedWith('Unauthorized()')
      await wcusdcV3.connect(bob).connect(bob).allow(don.address, true)
      const expectedAmount = await wcusdcV3.convertDynamicToStatic(await cusdcV3.balanceOf(bob.address))
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
  })

  describe('withdraw', () => {
    const initUsdcAmt = bn('20000e6')
    let startingBalance: BigNumberish;

    beforeEach(async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, initUsdcAmt, bob.address)
      startingBalance = await wcusdcV3.balanceOf(bob.address)
    })

    it('withdraws to own account', async () => {
      const expectedAmount = await wcusdcV3.underlyingBalanceOf(bob.address)
      await wcusdcV3.connect(bob).withdraw(ethers.constants.MaxUint256)
      const bal = await wcusdcV3.balanceOf(bob.address)
      expect(bal).to.eq(0)
      expect(await cusdcV3.balanceOf(bob.address)).to.closeTo(expectedAmount, 100)
    })

    it('withdraws to a different account', async () => {
      const expectedAmount = await wcusdcV3.underlyingBalanceOf(bob.address)
      await wcusdcV3.connect(bob).withdrawTo(don.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(don.address)).to.closeTo(expectedAmount, 100)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
    })

    it('withdraws from a different account', async () => {
      const withdrawAmount = await wcusdcV3.underlyingBalanceOf(bob.address)
      await expect(
        wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, withdrawAmount)
      ).to.be.revertedWith('Unauthorized')

      await wcusdcV3.connect(bob).allow(charles.address, true)
      await wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, withdrawAmount)

      expect(await cusdcV3.balanceOf(don.address)).to.closeTo(withdrawAmount, 100)
      expect(await cusdcV3.balanceOf(charles.address)).to.eq(0)

      expect(await wcusdcV3.balanceOf(bob.address)).to.closeTo(bn(0), 50)
    })

    it('withdraws all underlying balance via multiple withdrawals', async () => {
      await advanceTime(1000)
      const initialBalance = await wcusdcV3.underlyingBalanceOf(bob.address)
      const withdrawAmt = bn('10000e6')
      await wcusdcV3.connect(bob).withdraw(withdrawAmt)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.closeTo(initialBalance.sub(withdrawAmt), 50)
      await advanceTime(1000)
      await wcusdcV3.connect(bob).withdraw(ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.equal(0)
    })

    it('withdraws 0', async () => {
      const initialBalance = await wcusdcV3.balanceOf(bob.address)
      await wcusdcV3.connect(bob).withdraw(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(initialBalance)
    })
  })

  describe('transfer', () => {
    beforeEach(async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
    })

    it('does not transfer without approval', async () => {
      await expect(
        wcusdcV3.connect(bob).transferFrom(don.address, bob.address, bn('10000e6'))
      ).to.be.revertedWith('Unauthorized')
    })

    it('updates accruals and principals in sender and receiver', async () => {
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

      // Balances are computed from principals so we are indirectly testing the accuracy
      // of Bob's and Don's stored principals here.
      const donsBalance = (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt()
      const bobsBalance = (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt()
      expect(donsBalance).to.be.gt(bobsBalance)
      const totalBalances = donsBalance + bobsBalance

      // Rounding in favor of the Wrapped Token is happening here. Amount is negligible
      expect(totalBalances).to.be.closeTo(await cusdcV3.balanceOf(wcusdcV3.address), 1)
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
      const totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt()

      const contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.eq(contractBalance)
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

      let totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).add
        (await wcusdcV3.underlyingBalanceOf(bob.address)).add
        (await wcusdcV3.underlyingBalanceOf(charles.address))
      let contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 10)
      expect(totalBalances).to.be.lt(contractBalance)

      const bobBal = await wcusdcV3.balanceOf(bob.address)
      await wcusdcV3.connect(bob).withdraw(bobBal)
      await wcusdcV3.connect(don).withdraw(bn('10000e6'))

      totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).add
        (await wcusdcV3.underlyingBalanceOf(bob.address)).add
        (await wcusdcV3.underlyingBalanceOf(charles.address))
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
      expect(await wcusdcV3.getCurrentExchangeRate()).to.equal(expectedExchangeRate)
    })

    it('returns the correct exchange rate with a positive balance', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      const totalsBasic = await cusdcV3.totalsBasic()
      const baseIndexScale = await cusdcV3.baseIndexScale()
      const expectedExchangeRate = totalsBasic.baseSupplyIndex.mul(bn('1e6')).div(baseIndexScale)
      expect(await wcusdcV3.getCurrentExchangeRate()).to.equal(expectedExchangeRate)
    })

    it('current exchange rate is a ratio of total underlying balance and total supply', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'), bob.address)
      const totalSupply = (await wcusdcV3.totalSupply()).toBigInt()
      const underlyingBalance = (await cusdcV3.balanceOf(wcusdcV3.address)).toBigInt()
      expect(await wcusdcV3.getCurrentExchangeRate()).to.equal(
        (underlyingBalance * BigInt(1e6)) / totalSupply
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
      await expect(wcusdcV3.connect(don).claimTo(bob.address, bob.address)).to.be.revertedWith(
        'Unauthorized'
      )

      await wcusdcV3.connect(bob).allow(don.address, true)
      expect(await wcusdcV3.isAllowed(bob.address, don.address)).to.eq(true)
      await expect(wcusdcV3.connect(don).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardClaimed'
      )
    })

    it('claims rewards and sends to claimer', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await advanceTime(1000)
      await enableRewardsAccrual(cusdcV3)

      await expect(wcusdcV3.connect(bob).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardClaimed'
      )
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

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      await wcusdcV3.connect(don).claimTo(don.address, don.address)
      await network.provider.send('evm_setAutomine', [true])
      await advanceBlocks(1)

      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
      expect(await compToken.balanceOf(bob.address)).to.equal(
        await compToken.balanceOf(don.address)
      )
      // Excess COMP left from rounding behavior
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(1e12)
    })

    // In this forked block, rewards accrual is not yet enabled in Comet
    it('claims no rewards when rewards accrual is not enabled', async () => {
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

      await advanceTime(1000)
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      expect(await compToken.balanceOf(bob.address)).to.equal(0)
    })

    it('returns reward owed after accrual and claims', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'), don.address)

      await advanceTime(1000)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.getRewardOwed(bob.address)
      await wcusdcV3.getRewardOwed(don.address)
      await advanceBlocks(1)
      await network.provider.send('evm_setAutomine', [true])

      const bobsReward = await wcusdcV3.callStatic.getRewardOwed(bob.address)
      const donsReward = await wcusdcV3.callStatic.getRewardOwed(don.address)

      expect(bobsReward).to.be.greaterThan(donsReward)
      const accrued = (await await wcusdcV3.baseTrackingAccrued(bob.address)).mul(bn('1e12'))
      expect(bobsReward).to.equal(accrued)

      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      expect(await wcusdcV3.callStatic.getRewardOwed(bob.address)).to.equal(0)

      await advanceTime(1000)
      expect(await wcusdcV3.callStatic.getRewardOwed(bob.address)).to.be.greaterThan(0)
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
