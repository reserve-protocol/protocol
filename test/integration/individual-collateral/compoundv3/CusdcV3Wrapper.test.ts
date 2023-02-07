import { expect } from 'chai'
import { Wallet } from 'ethers'
import hre, { ethers, network, waffle } from 'hardhat'
import { advanceTime, advanceBlocks } from '../../../utils/time'
import { allocateUSDC, COMP, enableRewardsAccrual, mintWcUSDC } from './helpers'
import { cusdcFixture } from './fixtures'
import { ERC20Mock, CometInterface, CusdcV3Wrapper } from '../../../../typechain'
import { bn } from '../../../../common/numbers'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const createFixtureLoader = waffle.createFixtureLoader

describe('Wrapped CUSDCv3', () => {
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
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[, bob, charles, don] = await ethers.getSigners()
    ;({ usdc, wcusdcV3, cusdcV3 } = await loadFixture(cusdcFixture))
  })

  describe('deposit', () => {
    it('deposit to own account', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = bn('20000e6')
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, bn('20000e6'))
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.deposit(ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, 50)
    })

    it('deposits for someone else', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = bn('20000e6')
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, bn('20000e6'))
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositTo(don.address, ethers.constants.MaxUint256)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(don.address)).to.be.closeTo(balance, 50)
    })

    it('deposits from a different account', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = bn('20000e6')
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, bn('20000e6'))
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      expect(await wcusdcV3.balanceOf(charles.address)).to.eq(0)
      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await expect(
        wcusdcV3.connect(don).depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)
      ).revertedWith('Unauthorized()')
      await wcusdcV3AsB.connect(bob).allow(don.address, true)
      await wcusdcV3
        .connect(don)
        .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(charles.address)).to.be.closeTo(balance, 50)
    })

    it('deposits max uint256 and mints available amount of wrapped cusdc', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = bn('20000e6')
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, bn('20000e6'))
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositTo(bob.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, 100)
    })

    it('deposits less than available cusdc', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = bn('20000e6')
      await allocateUSDC(bob.address, balance)

      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, bn('20000e6'))
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositTo(bob.address, bn('10000e6'))
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(bn('10000e6'), 100)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(bn('10000e6'))
    })

    it('user that deposits must have same baseTrackingIndex as this Token in Comet', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      expect((await cusdcV3.callStatic.userBasic(wcusdcV3.address)).baseTrackingIndex).to.equal(
        await wcusdcV3.baseTrackingIndex(bob.address)
      )
    })

    it('multiple deposits lead to accurate balances', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = bn('40000e6')
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, balance)
      await cusdcV3AsB.allow(wcusdcV3.address, true)

      await wcusdcV3AsB.depositTo(bob.address, bn('10000e6'))
      await advanceTime(1000)
      await wcusdcV3AsB.depositTo(bob.address, bn('10000e6'))
      await advanceTime(1000)
      await wcusdcV3AsB.depositTo(bob.address, bn('10000e6'))
      await advanceTime(1000)
      await wcusdcV3AsB.depositTo(bob.address, bn('10000e6'))

      // The more wcUSDCv3 is minted, the higher its value is relative to cUSDCv3.
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.gt(balance)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, bn('10e6'))

      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.closeTo(
        await cusdcV3.balanceOf(wcusdcV3.address),
        1
      )
    })
  })

  describe('withdraw', () => {
    it('withdraws to own account', async () => {
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await expect(wcusdcV3AsB.withdraw(ethers.constants.MaxUint256)).to.changeTokenBalance(
        wcusdcV3,
        bob,
        0
      )

      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(bn('20000e6'), 50)
    })

    it('withdraws to a different account', async () => {
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await wcusdcV3AsB.withdrawTo(don.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(don.address)).to.be.closeTo(bn('20000e6'), 50)
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(bn(0), 50)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
    })

    it('withdraws from a different account', async () => {
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))

      await expect(
        wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, bn('20000e6'))
      ).to.be.revertedWith('Unauthorized')

      await wcusdcV3AsB.allow(charles.address, true)
      await wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, bn('20000e6'))

      expect(await cusdcV3.balanceOf(don.address)).be.closeTo(bn('20000e6'), 50)
      expect(await cusdcV3.balanceOf(bob.address)).be.closeTo(bn(0), 50)
      expect(await cusdcV3.balanceOf(charles.address)).to.eq(0)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
    })

    it('withdraws all underlying balance via multiple withdrawals', async () => {
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))

      await advanceTime(1000)
      await wcusdcV3AsB.withdraw(bn('10000e6'))
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(bn('10000e6'))
      await advanceTime(1000)
      await wcusdcV3AsB.withdraw(bn('10000e6'))
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(0)
    })

    it('withdraws 0', async () => {
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await wcusdcV3AsB.withdraw(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(bn('20000e6'))
    })

    it('updates and principals in withdrawn account', async () => {
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await wcusdcV3AsB.withdraw(bn('5000e6'))

      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(bn('15000e6'))
      const bobsCusdc = await wcusdcV3.underlyingBalanceOf(bob.address)
      expect(bobsCusdc).to.be.gt(0)
      expect(bobsCusdc).to.be.closeTo(await cusdcV3.balanceOf(wcusdcV3.address), 1)
    })
  })

  describe('transfer', () => {
    it('does not transfer without approval', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))

      await expect(
        wcusdcV3.connect(bob).transferFrom(don.address, bob.address, bn('10000e6'))
      ).to.be.revertedWith('Unauthorized')
    })

    it('updates accruals and principals in sender and receiver', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))

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
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
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
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
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
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      const wrappedBalance = await wcusdcV3.balanceOf(bob.address)
      await advanceTime(1000)
      expect(wrappedBalance).to.equal(await wcusdcV3.balanceOf(bob.address))
      // Underlying balance increases over time and is greater than the balance in the wrapped token
      expect(wrappedBalance).to.be.lt(await wcusdcV3.underlyingBalanceOf(bob.address))
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.eq(
        await cusdcV3.balanceOf(wcusdcV3.address)
      )

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))
      await advanceTime(1000)
      const totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt()

      const contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 1)
      expect(totalBalances).to.be.lt(contractBalance)
    })

    it('returns 0 when user has no balance', async () => {
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.equal(0)
    })

    it('also accrues account in Comet to ensure that global indices are updated', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      const oldTrackingSupplyIndex = (await cusdcV3.totalsBasic()).trackingSupplyIndex

      await advanceTime(1000)
      await wcusdcV3.accrueAccount(bob.address)
      expect(oldTrackingSupplyIndex).to.be.lessThan(
        (await cusdcV3.totalsBasic()).trackingSupplyIndex
      )
    })

    it('matches balance in cUSDCv3', async () => {
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)

      await network.provider.send('evm_setAutomine', [false])
      await allocateUSDC(bob.address, bn('20000e6'))
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await advanceBlocks(1)
      await network.provider.send('evm_setAutomine', [true])

      // Minting more wcUSDC to other accounts should not affect
      // Bob's underlying balance
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charles, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))
      await advanceTime(100000)

      let totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(charles.address)).toBigInt()

      // There are negligible rounding differences of ~.000002 in favor of the Token
      // contract.
      let contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 2)
      expect(totalBalances).to.be.lt(contractBalance)

      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(
        await wcusdcV3.underlyingBalanceOf(bob.address),
        2
      )

      await wcusdcV3.connect(bob).withdraw(bn('20000e6'))
      await wcusdcV3.connect(don).withdraw(bn('10000e6'))

      totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(charles.address)).toBigInt()
      contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 2)
      expect(totalBalances).to.be.lt(contractBalance)
    })
  })

  describe('exchange rate', () => {
    it('returns 1e18 when wrapped token has 0 balance', async () => {
      expect(await cusdcV3.balanceOf(wcusdcV3.address)).to.equal(0)
      expect(await wcusdcV3.exchangeRate()).to.equal(bn('1e18'))
    })

    it('returns 1e18 when wrapped token has 0 supply of the underlying token', async () => {
      expect(await wcusdcV3.totalSupply()).to.equal(0)
      expect(await wcusdcV3.exchangeRate()).to.equal(bn('1e18'))
    })

    it('computes exchange rate based on total underlying balance and total supply of wrapped token', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      const totalSupply = (await wcusdcV3.totalSupply()).toBigInt()
      const underlyingBalance = (await cusdcV3.balanceOf(wcusdcV3.address)).toBigInt()
      expect(await wcusdcV3.exchangeRate()).to.equal(
        (underlyingBalance * BigInt(1e18)) / totalSupply
      )
    })
  })

  describe('claiming rewards', () => {
    it('does not claim rewards when user has no permission', async () => {
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
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
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
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

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))

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

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await advanceTime(1000)
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      expect(await compToken.balanceOf(bob.address)).to.equal(0)
    })

    it('returns reward owed after accrual and claims', async () => {
      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))

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
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      let wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(await wcusdcV3.baseTrackingAccrued(bob.address))

      await wcusdcV3.accrueAccount(bob.address)

      wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(await wcusdcV3.baseTrackingAccrued(bob.address))
      expect((await cusdcV3.callStatic.userBasic(wcusdcV3.address)).baseTrackingIndex).to.equal(
        await wcusdcV3.baseTrackingIndex(bob.address)
      )

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charles, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))

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
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, bn('20000e6'))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, bn('20000e6'))

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
      expect(wrappedTokenAccrued).to.equal(totalUsersAccrued)
    })
  })
})
