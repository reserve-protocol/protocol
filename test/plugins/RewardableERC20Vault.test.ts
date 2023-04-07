import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { Wallet, ContractFactory, BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import {
  ERC20MockDecimals,
  ERC20MockRewarding,
  RewardableERC20Vault,
  RewardableERC20VaultTest,
} from '../../typechain'
import { cartesianProduct } from '../utils/cases'
import { useEnv } from '#/utils/env'
import { Implementation } from '../fixtures'
import snapshotGasCost from '../utils/snapshotGasCost'

type Fixture<T> = () => Promise<T>

interface RewardableERC20VaultFixture {
  rewardableVault: RewardableERC20Vault
  rewardableAsset: ERC20MockRewarding
  rewardToken: ERC20MockDecimals
}

const getFixture = (
  decimals: number,
  rewardDecimals: number
): Fixture<RewardableERC20VaultFixture> => {
  const fixture: Fixture<RewardableERC20VaultFixture> =
    async function (): Promise<RewardableERC20VaultFixture> {
      const rewardTokenFactory: ContractFactory = await ethers.getContractFactory(
        'ERC20MockDecimals'
      )
      const rewardToken = <ERC20MockDecimals>(
        await rewardTokenFactory.deploy('Reward Token', 'REWARD', rewardDecimals)
      )

      const rewardableAssetFactory: ContractFactory = await ethers.getContractFactory(
        'ERC20MockRewarding'
      )
      const rewardableAsset = <ERC20MockRewarding>(
        await rewardableAssetFactory.deploy(
          'Rewarding Test Asset',
          'rewardTEST',
          decimals,
          rewardToken.address
        )
      )

      const rewardableVaultFactory: ContractFactory = await ethers.getContractFactory(
        'RewardableERC20VaultTest'
      )
      const rewardableVault = <RewardableERC20VaultTest>(
        await rewardableVaultFactory.deploy(
          rewardableAsset.address,
          'Rewarding Test Asset Vault',
          'vrewardTEST',
          rewardToken.address
        )
      )

      return {
        rewardableVault,
        rewardableAsset,
        rewardToken,
      }
    }
  return fixture
}

const runTests = (decimals: number, rewardDecimals: number) => {
  describe('RewardableERC20Vault', () => {
    // Assets
    let rewardableVault: RewardableERC20Vault
    let rewardableAsset: ERC20MockRewarding
    let rewardToken: ERC20MockDecimals

    // Main
    let alice: Wallet
    let bob: Wallet

    const initBalance = fp('10000').div(bn(10).pow(18 - decimals))
    const rewardAmount = fp('200').div(bn(10).pow(18 - rewardDecimals))
    const oneAsset = fp('1').div(bn(10).pow(18 - decimals))

    const fixture = getFixture(decimals, rewardDecimals)

    before('load wallets', async () => {
      ;[alice, bob] = (await ethers.getSigners()) as unknown as Wallet[]
    })

    beforeEach(async () => {
      // Deploy fixture
      ;({ rewardableVault, rewardableAsset, rewardToken } = await loadFixture(fixture))

      await rewardableAsset.mint(alice.address, initBalance)
      await rewardableAsset.connect(alice).approve(rewardableVault.address, initBalance)
      await rewardableAsset.mint(bob.address, initBalance)
      await rewardableAsset.connect(bob).approve(rewardableVault.address, initBalance)
    })

    describe('Deployment', () => {
      it('sets the rewardableVault rewardableAsset', async () => {
        const seenAsset = await rewardableVault.asset()
        expect(seenAsset).equal(rewardableAsset.address)
      })

      it('sets the rewardableVault reward token', async () => {
        const seenRewardToken = await rewardableVault.rewardToken()
        expect(seenRewardToken).equal(rewardToken.address)
      })
    })

    describe('alice deposit, accrue, alice deposit, bob deposit', () => {
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(alice).deposit(initBalance.div(8), alice.address)

        // bob deposit
        await rewardableVault.connect(bob).deposit(initBalance.div(8), bob.address)

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct balance', async () => {
        expect(initBalance.mul(3).div(8)).equal(await rewardableVault.balanceOf(alice.address))
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('bob shows correct balance', async () => {
        expect(initBalance.div(8)).equal(await rewardableVault.balanceOf(bob.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })

      it('rewardsPerShare is correct', async () => {
        // rewards / alice's deposit
        expect(rewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)))
      })
    })

    describe('alice deposit, accrue, alice deposit, accrue, bob deposit', () => {
      let rewardsPerShare: BigNumber
      let initRewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)

        initRewardsPerShare = await rewardableVault.rewardsPerShare()

        // accrue
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

        // bob deposit
        await rewardableVault.connect(alice).deposit(initBalance.div(8), bob.address)

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        // rewards / alice's deposit
        expect(initRewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)))
        expect(initRewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        const expectedRewardsPerShare = rewardAmount
          .mul(oneAsset)
          .div(initBalance.div(4))
          .add(rewardAmount.mul(oneAsset).div(initBalance.div(2)))
        expect(rewardsPerShare).equal(expectedRewardsPerShare)
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })
    })

    describe('alice deposit, accrue, alice withdraw', () => {
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault
          .connect(alice)
          .withdraw(initBalance.div(8), alice.address, alice.address)

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('rewardsPerShare is correct', async () => {
        // rewards / alice's deposit
        expect(rewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)))
      })
    })

    describe('alice deposit, accrue, bob deposit, alice withdraw', () => {
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
        await rewardableVault
          .connect(alice)
          .withdraw(initBalance.div(8), alice.address, alice.address)

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })

      it('rewardsPerShare is correct', async () => {
        // rewards / alice's deposit
        expect(rewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)))
      })
    })

    describe('alice deposit, accrue, bob deposit, alice fully withdraw', () => {
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
        await rewardableVault
          .connect(alice)
          .withdraw(initBalance.div(4), alice.address, alice.address)

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct balance', async () => {
        expect(0).equal(await rewardableVault.balanceOf(alice.address))
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('bob shows correct balance', async () => {
        expect(initBalance.div(4)).equal(await rewardableVault.balanceOf(bob.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })

      it('rewardsPerShare is correct', async () => {
        // rewards / alice's deposit
        expect(rewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)))
      })
    })

    describe('alice deposit, accrue, alice claim, bob deposit', () => {
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(alice).claimRewards()

        // bob deposit
        await rewardableVault.connect(bob).deposit(initBalance.div(8), bob.address)

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct balance', async () => {
        expect(initBalance.div(4)).equal(await rewardableVault.balanceOf(alice.address))
      })

      it('alice has claimed rewards', async () => {
        expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('bob shows correct balance', async () => {
        expect(initBalance.div(8)).equal(await rewardableVault.balanceOf(bob.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })

      it('rewardsPerShare is correct', async () => {
        // rewards / alice's deposit
        expect(rewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)))
      })
    })

    describe('alice deposit, accrue, bob deposit, accrue, bob claim, alice claim', () => {
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

        // bob deposit
        await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)

        // accrue
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

        // claims
        await rewardableVault.connect(bob).claimRewards()
        await rewardableVault.connect(alice).claimRewards()

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct balance', async () => {
        expect(initBalance.div(4)).equal(await rewardableVault.balanceOf(alice.address))
      })

      it('alice has claimed rewards', async () => {
        expect(rewardAmount.add(rewardAmount.div(2))).equal(
          await rewardToken.balanceOf(alice.address)
        )
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('bob shows correct balance', async () => {
        expect(initBalance.div(4)).equal(await rewardableVault.balanceOf(bob.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })

      it('bob has claimed rewards', async () => {
        expect(rewardAmount.div(2)).equal(await rewardToken.balanceOf(bob.address))
      })

      it('rewardsPerShare is correct', async () => {
        // (rewards / alice's deposit) + (rewards / (alice's deposit + bob's deposit))
        const expectedRewardsPerShare = rewardAmount
          .mul(oneAsset)
          .div(initBalance.div(4))
          .add(rewardAmount.mul(oneAsset).div(initBalance.div(2)))
        expect(rewardsPerShare).equal(expectedRewardsPerShare)
      })
    })

    describe('does not accure rewards for an account while it has no deposits', () => {
      // alice deposit, accrue, bob deposit, alice fully withdraw, accrue, alice deposit, alice claim, bob claim
      let rewardsPerShare: BigNumber

      beforeEach(async () => {
        // alice deposit, accrue, and claim
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
        await rewardableVault
          .connect(alice)
          .withdraw(initBalance.div(4), alice.address, alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
        await rewardableVault.connect(bob).claimRewards()
        await rewardableVault.connect(alice).claimRewards()

        rewardsPerShare = await rewardableVault.rewardsPerShare()
      })

      it('alice shows correct balance', async () => {
        expect(initBalance.div(4)).equal(await rewardableVault.balanceOf(alice.address))
      })

      it('alice shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
      })

      it('alice has claimed rewards', async () => {
        expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
      })

      it('bob shows correct balance', async () => {
        expect(initBalance.div(4)).equal(await rewardableVault.balanceOf(bob.address))
      })

      it('bob shows correct lastRewardsPerShare', async () => {
        expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
      })

      it('bob has claimed rewards', async () => {
        expect(rewardAmount).equal(await rewardToken.balanceOf(bob.address))
      })

      it('rewardsPerShare is correct', async () => {
        // (rewards / alice's deposit) + (rewards / bob's deposit)
        expect(rewardsPerShare).equal(rewardAmount.mul(oneAsset).div(initBalance.div(4)).mul(2))
      })
    })
  })
}

const decimalSeeds = [6, 8, 18]
const cases = cartesianProduct(decimalSeeds, decimalSeeds)
// const cases = [[6, 6]]
cases.forEach((params) => {
  describe(`rewardableAsset decimals: ${params[0]} / reward decimals: ${params[1]}`, () => {
    runTests(params[0], params[1])
  })
})

export const IMPLEMENTATION: Implementation =
  useEnv('PROTO_IMPL') == Implementation.P1.toString() ? Implementation.P1 : Implementation.P0

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describeGas('Gas Reporting', () => {
  // Assets
  let rewardableVault: RewardableERC20Vault
  let rewardableAsset: ERC20MockRewarding

  // Main
  let alice: Wallet

  const initBalance = fp('10000')
  const rewardAmount = fp('200')

  const fixture = getFixture(18, 18)

  before('load wallets', async () => {
    ;[alice] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach(async () => {
    // Deploy fixture
    ;({ rewardableVault, rewardableAsset } = await loadFixture(fixture))

    await rewardableAsset.mint(alice.address, initBalance)
    await rewardableAsset.connect(alice).approve(rewardableVault.address, initBalance)
  })

  describe('RewardableERC20Vault', () => {
    it('deposit', async function () {
      // Deposit
      await snapshotGasCost(
        rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
      )

      // Deposit again
      await snapshotGasCost(
        rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
      )
    })

    it('withdraw', async function () {
      await rewardableVault.connect(alice).deposit(initBalance, alice.address)

      await snapshotGasCost(
        rewardableVault.connect(alice).withdraw(initBalance.div(2), alice.address, alice.address)
      )

      await snapshotGasCost(
        rewardableVault.connect(alice).withdraw(initBalance.div(2), alice.address, alice.address)
      )
    })

    it('claimRewards', async function () {
      await rewardableVault.connect(alice).deposit(initBalance, alice.address)

      await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

      await snapshotGasCost(rewardableVault.connect(alice).claimRewards())

      await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

      await snapshotGasCost(rewardableVault.connect(alice).claimRewards())
    })
  })
})
