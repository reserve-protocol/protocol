import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { Wallet, ContractFactory, ContractTransaction, BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import {
  ERC20MockDecimals,
  ERC20MockRewarding,
  RewardableERC20Wrapper,
  RewardableERC20WrapperTest,
  RewardableERC4626Vault,
  RewardableERC4626VaultTest,
} from '../../typechain'
import { cartesianProduct } from '../utils/cases'
import { useEnv } from '#/utils/env'
import { Implementation } from '../fixtures'
import snapshotGasCost from '../utils/snapshotGasCost'
import { formatUnits, parseUnits } from 'ethers/lib/utils'
import { MAX_UINT256 } from '#/common/constants'

const SHARE_DECIMAL_OFFSET = 9 // decimals buffer for shares and rewards per share
const BN_SHARE_FACTOR = bn(10).pow(SHARE_DECIMAL_OFFSET)

type Fixture<T> = () => Promise<T>

interface RewardableERC20Fixture {
  rewardableVault: RewardableERC4626VaultTest | RewardableERC20WrapperTest
  rewardableAsset: ERC20MockRewarding
  rewardToken: ERC20MockDecimals
  rewardableVaultFactory: ContractFactory
}

// 18 cases: test two wrappers with 2 combinations of decimals [6, 8, 18]

enum Wrapper {
  ERC20 = 'RewardableERC20WrapperTest',
  ERC4626 = 'RewardableERC4626VaultTest',
}
const wrapperNames: Wrapper[] = [Wrapper.ERC20, Wrapper.ERC4626]

for (const wrapperName of wrapperNames) {
  // this style preferred due to handling gas section correctly

  const getFixture = (
    assetDecimals: number,
    rewardDecimals: number
  ): Fixture<RewardableERC20Fixture> => {
    const fixture: Fixture<RewardableERC20Fixture> =
      async function (): Promise<RewardableERC20Fixture> {
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
            assetDecimals,
            rewardToken.address
          )
        )

        const rewardableVaultFactory: ContractFactory = await ethers.getContractFactory(wrapperName)
        const rewardableVault = <RewardableERC4626VaultTest | RewardableERC20WrapperTest>(
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
          rewardableVaultFactory,
        }
      }
    return fixture
  }

  const toShares = (assets: BigNumber, assetDecimals: number, shareDecimals: number): BigNumber => {
    return assets.mul(bn(10).pow(shareDecimals - assetDecimals))
  }

  // helper to handle different withdraw() signatures for each wrapper type
  const withdraw = (
    wrapper: RewardableERC4626Vault | RewardableERC20Wrapper,
    amount: BigNumber,
    to: string
  ): Promise<ContractTransaction> => {
    if (wrapperName == Wrapper.ERC20) {
      const wrapperERC20 = wrapper as RewardableERC20Wrapper
      return wrapperERC20.withdraw(amount, to)
    } else {
      const wrapperERC4626 = wrapper as RewardableERC4626Vault
      return wrapperERC4626.withdraw(amount, to, to)
    }
  }
  const withdrawAll = async (
    wrapper: RewardableERC4626Vault | RewardableERC20Wrapper,
    to?: string
  ): Promise<ContractTransaction> => {
    const owner = await wrapper.signer.getAddress()
    to = to || owner
    if (wrapperName == Wrapper.ERC20) {
      const wrapperERC20 = wrapper as RewardableERC20Wrapper
      return wrapperERC20.withdraw(await wrapperERC20.balanceOf(owner), to)
    } else {
      const wrapperERC4626 = wrapper as RewardableERC4626Vault
      return wrapperERC4626.withdraw(await wrapperERC4626.maxWithdraw(owner), to, owner)
    }
  }

  const runTests = (assetDecimals: number, rewardDecimals: number) => {
    describe(wrapperName, () => {
      // Decimals
      let shareDecimals: number
      let rewardShareDecimals: number
      // Assets
      let rewardableVault: RewardableERC20WrapperTest | RewardableERC4626VaultTest
      let rewardableAsset: ERC20MockRewarding
      let rewardToken: ERC20MockDecimals
      let rewardableVaultFactory: ContractFactory

      // Main
      let alice: Wallet
      let bob: Wallet

      const initBalance = parseUnits('10000', assetDecimals)
      let rewardAmount = parseUnits('200', rewardDecimals)
      let oneShare: BigNumber
      let initShares: BigNumber

      const fixture = getFixture(assetDecimals, rewardDecimals)

      before('load wallets', async () => {
        ;[alice, bob] = (await ethers.getSigners()) as unknown as Wallet[]
      })

      beforeEach(async () => {
        // Deploy fixture
        ;({ rewardableVault, rewardableAsset, rewardToken, rewardableVaultFactory } =
          await loadFixture(fixture))

        await rewardableAsset.mint(alice.address, initBalance)
        await rewardableAsset.connect(alice).approve(rewardableVault.address, initBalance)
        await rewardableAsset.mint(bob.address, initBalance)
        await rewardableAsset.connect(bob).approve(rewardableVault.address, initBalance)

        shareDecimals = (await rewardableVault.decimals()) + SHARE_DECIMAL_OFFSET
        rewardShareDecimals = rewardDecimals + SHARE_DECIMAL_OFFSET
        initShares = toShares(initBalance, assetDecimals, shareDecimals)
        oneShare = bn('1').mul(bn(10).pow(shareDecimals))
      })

      describe('Deployment', () => {
        it('sets the rewardableVault rewardableAsset', async () => {
          const seenAsset = await (wrapperName == Wrapper.ERC4626
            ? (rewardableVault as RewardableERC4626Vault).asset()
            : (rewardableVault as RewardableERC20Wrapper).underlying())

          expect(seenAsset).equal(rewardableAsset.address)
        })

        it('sets the rewardableVault reward token', async () => {
          const seenRewardToken = await rewardableVault.rewardToken()
          expect(seenRewardToken).equal(rewardToken.address)
        })

        it('no rewards yet', async () => {
          await rewardableVault.connect(alice).claimRewards()
          expect(await rewardableVault.rewardsPerShare()).to.equal(bn(0))
          expect(await rewardableVault.lastRewardsPerShare(alice.address)).to.equal(bn(0))
        })

        it('supports direct airdrops', async () => {
          await rewardableVault
            .connect(alice)
            .deposit(parseUnits('10', assetDecimals), alice.address)
          expect(await rewardableVault.rewardsPerShare()).to.equal(bn(0))
          expect(await rewardableVault.lastRewardsPerShare(alice.address)).to.equal(bn(0))
          await rewardToken.mint(rewardableVault.address, parseUnits('10', rewardDecimals))
          await rewardableVault.sync()
          expect(await rewardableVault.rewardsPerShare()).to.equal(
            parseUnits('1', rewardShareDecimals)
          )
        })

        it('correctly handles reward tracking if supply is burned', async () => {
          await rewardableVault
            .connect(alice)
            .deposit(parseUnits('10', assetDecimals), alice.address)
          expect(await rewardableVault.rewardsPerShare()).to.equal(bn(0))
          expect(await rewardableVault.lastRewardsPerShare(alice.address)).to.equal(bn(0))
          await rewardToken.mint(rewardableVault.address, parseUnits('10', rewardDecimals))
          await rewardableVault.sync()
          expect(await rewardableVault.rewardsPerShare()).to.equal(
            parseUnits('1', rewardShareDecimals)
          )

          // Setting supply to 0
          await withdrawAll(rewardableVault.connect(alice))
          expect(await rewardableVault.totalSupply()).to.equal(bn(0))

          // Add some undistributed reward tokens to the vault
          await rewardToken.mint(rewardableVault.address, parseUnits('10', rewardDecimals))

          // Claim whatever rewards are available
          expect(await rewardToken.balanceOf(alice.address)).to.be.equal(bn(0))
          await rewardableVault.connect(alice).claimRewards()

          expect(await rewardToken.balanceOf(alice.address)).to.be.equal(
            parseUnits('10', rewardDecimals)
          )

          // Nothing updates.. as totalSupply as totalSupply is 0
          await rewardableVault.sync()
          expect(await rewardableVault.rewardsPerShare()).to.equal(
            parseUnits('1', rewardShareDecimals)
          )
          await rewardableVault
            .connect(alice)
            .deposit(parseUnits('10', assetDecimals), alice.address)
          await rewardableVault.sync()

          await rewardableVault.connect(alice).claimRewards()
          expect(await rewardToken.balanceOf(alice.address)).to.be.equal(
            parseUnits('20', rewardDecimals)
          )
        })

        it('checks reward and underlying token are not the same', async () => {
          const errorMsg =
            wrapperName == Wrapper.ERC4626
              ? 'reward and asset cannot match'
              : 'reward and underlying cannot match'

          // Attempt to deploy with same reward and underlying
          await expect(
            rewardableVaultFactory.deploy(
              rewardableAsset.address,
              'Rewarding Test Asset Vault',
              'vrewardTEST',
              rewardableAsset.address
            )
          ).to.be.revertedWith(errorMsg)
        })

        it('1 wei supply', async () => {
          await rewardableVault.connect(alice).deposit('1', alice.address)
          expect(await rewardableVault.rewardsPerShare()).to.equal(bn(0))
          expect(await rewardableVault.lastRewardsPerShare(alice.address)).to.equal(bn(0))
          await rewardToken.mint(rewardableVault.address, parseUnits('1', rewardDecimals))
          await rewardableVault.sync()
          await rewardableVault.connect(bob).deposit('10', bob.address)
          await rewardableVault.connect(alice).deposit('10', alice.address)
          await rewardToken.mint(rewardableVault.address, parseUnits('99', rewardDecimals))
          await rewardableVault.connect(alice).claimRewards()
          await rewardableVault.connect(bob).claimRewards()
          const aliceBalance = await rewardToken.balanceOf(await alice.getAddress())
          const bobBalance = await rewardToken.balanceOf(await bob.getAddress())

          expect(parseFloat(formatUnits(aliceBalance, rewardDecimals))).to.be.closeTo(52.8, 0.1)

          expect(parseFloat(formatUnits(bobBalance, rewardDecimals))).to.be.closeTo(47.1, 0.1)
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
          expect(initShares.mul(3).div(8).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(alice.address)
          )
        })

        it('alice shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
        })

        it('bob shows correct balance', async () => {
          expect(initShares.div(8).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(bob.address)
          )
        })

        it('bob shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
        })

        it('rewardsPerShare is correct', async () => {
          // rewards / alice's deposit
          expect(rewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(BN_SHARE_FACTOR)
          )
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
          expect(initRewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(BN_SHARE_FACTOR)
          )
          expect(initRewardsPerShare).equal(
            await rewardableVault.lastRewardsPerShare(alice.address)
          )
        })

        it('bob shows correct lastRewardsPerShare', async () => {
          const expectedRewardsPerShare = rewardAmount
            .mul(oneShare)
            .div(initShares.div(4))
            .add(rewardAmount.mul(oneShare).div(initShares.div(2)))
            .mul(BN_SHARE_FACTOR)
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
          await withdraw(rewardableVault.connect(alice), initBalance.div(8), alice.address)

          rewardsPerShare = await rewardableVault.rewardsPerShare()
        })

        it('alice shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
        })

        it('rewardsPerShare is correct', async () => {
          // rewards / alice's deposit
          expect(rewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(BN_SHARE_FACTOR)
          )
        })
      })

      describe('alice deposit and withdraw with 0 amount', () => {
        beforeEach(async () => {
          // alice deposit, accrue, and claim - 0 amount
          await rewardableVault.connect(alice).deposit(bn(0), alice.address)
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          await withdraw(rewardableVault.connect(alice), bn(0), alice.address)
        })

        it('no rewards', async () => {
          expect(await rewardableVault.lastRewardsPerShare(alice.address)).to.equal(bn(0))
          expect(await rewardableVault.rewardsPerShare()).to.equal(bn(0))
        })
      })

      describe('alice deposit, accrue, bob deposit, alice withdraw', () => {
        let rewardsPerShare: BigNumber

        beforeEach(async () => {
          // alice deposit, accrue, and claim
          await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
          await withdraw(rewardableVault.connect(alice), initBalance.div(8), alice.address)

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
          expect(rewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(BN_SHARE_FACTOR)
          )
        })
      })

      describe('alice deposit, accrue, bob deposit, alice fully withdraw', () => {
        let rewardsPerShare: BigNumber

        beforeEach(async () => {
          // alice deposit, accrue, and claim
          await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
          await withdraw(rewardableVault.connect(alice), initBalance.div(4), alice.address)

          rewardsPerShare = await rewardableVault.rewardsPerShare()
        })

        it('alice shows correct balance', async () => {
          expect(0).equal(await rewardableVault.balanceOf(alice.address))
        })

        it('alice shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
        })

        it('bob shows correct balance', async () => {
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(bob.address)
          )
        })

        it('bob shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
        })

        it('rewardsPerShare is correct', async () => {
          // rewards / alice's deposit
          expect(rewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(BN_SHARE_FACTOR)
          )
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
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(alice.address)
          )
        })

        it('alice has claimed rewards', async () => {
          expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
        })

        it('alice shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
        })

        it('bob shows correct balance', async () => {
          expect(initShares.div(8).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(bob.address)
          )
        })

        it('bob shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
        })

        it('rewardsPerShare is correct', async () => {
          // rewards / alice's deposit
          expect(rewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(BN_SHARE_FACTOR)
          )
        })
      })

      it('Cannot frontrun claimRewards by inflating your shares', async () => {
        await rewardableAsset.connect(bob).approve(rewardableVault.address, MAX_UINT256)
        await rewardableAsset.mint(bob.address, initBalance.mul(100))
        await rewardableVault.connect(alice).deposit(initBalance, alice.address)
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

        // Bob 'flashloans' 100x the current balance of the vault and claims rewards
        await rewardableVault.connect(bob).deposit(initBalance.mul(100), bob.address)
        await rewardableVault.connect(bob).claimRewards()

        // Alice claimsRewards a bit later
        await rewardableVault.connect(alice).claimRewards()
        expect(await rewardToken.balanceOf(alice.address)).to.be.gt(
          await rewardToken.balanceOf(bob.address)
        )
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
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(alice.address)
          )
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
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(bob.address)
          )
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
            .mul(oneShare)
            .div(initShares.div(4))
            .add(rewardAmount.mul(oneShare).div(initShares.div(2)))
            .mul(BN_SHARE_FACTOR)
          expect(rewardsPerShare).equal(expectedRewardsPerShare)
        })
      })

      describe('does not accure rewards for an account while it has no deposits', () => {
        // alice deposit, accrue, bob deposit, alice fully withdraw, accrue, alice deposit, alice claim, bob claim
        let rewardsPerShare: BigNumber

        beforeEach(async () => {
          // alice deposit, accrue, and claim
          await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
          // accrue
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          // bob deposit
          await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
          // alice withdraw all
          await withdraw(rewardableVault.connect(alice), initBalance.div(4), alice.address)
          // accrue
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          // alice re-deposit
          await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
          // both claim
          await rewardableVault.connect(bob).claimRewards()
          await rewardableVault.connect(alice).claimRewards()

          rewardsPerShare = await rewardableVault.rewardsPerShare()
        })

        it('alice shows correct balance', async () => {
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(alice.address)
          )
        })

        it('alice shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
        })

        it('alice has claimed rewards', async () => {
          expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
        })

        it('bob shows correct balance', async () => {
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(bob.address)
          )
        })

        it('bob shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
        })

        it('bob has claimed rewards', async () => {
          expect(rewardAmount).equal(await rewardToken.balanceOf(bob.address))
        })

        it('rewardsPerShare is correct', async () => {
          // (rewards / alice's deposit) + (rewards / bob's deposit)
          expect(rewardsPerShare).equal(
            rewardAmount.mul(oneShare).div(initShares.div(4)).mul(2).mul(BN_SHARE_FACTOR)
          )
        })
      })

      describe('correctly updates rewards on transfer', () => {
        let rewardsPerShare: BigNumber

        beforeEach(async () => {
          await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          await rewardableVault.connect(bob).deposit(initBalance.div(4), bob.address)
          await rewardableVault
            .connect(alice)
            .transfer(bob.address, initShares.div(4).div(BN_SHARE_FACTOR))
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
          await rewardableVault.connect(alice).deposit(initBalance.div(4), alice.address)
          await rewardableVault.connect(bob).claimRewards()
          await rewardableVault.connect(alice).claimRewards()

          rewardsPerShare = await rewardableVault.rewardsPerShare()
        })

        it('alice shows correct balance', async () => {
          expect(initShares.div(4).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(alice.address)
          )
        })

        it('alice shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(alice.address))
        })

        it('alice has claimed rewards', async () => {
          expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
        })

        it('bob shows correct balance', async () => {
          expect(initShares.div(2).div(BN_SHARE_FACTOR)).equal(
            await rewardableVault.balanceOf(bob.address)
          )
        })

        it('bob shows correct lastRewardsPerShare', async () => {
          expect(rewardsPerShare).equal(await rewardableVault.lastRewardsPerShare(bob.address))
        })

        it('bob has claimed rewards', async () => {
          expect(rewardAmount).equal(await rewardToken.balanceOf(bob.address))
        })

        it('rewardsPerShare is correct', async () => {
          // (rewards / alice's deposit) + (rewards / (alice's deposit + bob's deposit))
          expect(rewardsPerShare).equal(
            rewardAmount
              .mul(oneShare)
              .div(initShares.div(4))
              .add(rewardAmount.mul(oneShare).div(initShares.div(2)))
              .mul(BN_SHARE_FACTOR)
          )
        })
      })

      describe('correctly applies fractional reward tracking', () => {
        rewardAmount = parseUnits('1.9', rewardDecimals)

        beforeEach(async () => {
          // Deploy fixture
          ;({ rewardableVault, rewardableAsset } = await loadFixture(fixture))

          await rewardableAsset.mint(alice.address, initBalance)
          await rewardableAsset.connect(alice).approve(rewardableVault.address, MAX_UINT256)
          await rewardableAsset.mint(bob.address, initBalance)
          await rewardableAsset.connect(bob).approve(rewardableVault.address, MAX_UINT256)
        })

        it('Correctly handles fractional rewards', async () => {
          expect(await rewardableVault.rewardsPerShare()).to.equal(0)

          await rewardableVault.connect(alice).deposit(initBalance, alice.address)

          for (let i = 0; i < 10; i++) {
            await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
            await rewardableVault.claimRewards()
            expect(await rewardableVault.rewardsPerShare()).to.equal(
              rewardAmount
                .mul(i + 1)
                .mul(oneShare)
                .div(initShares)
                .mul(BN_SHARE_FACTOR)
            )
          }
        })
      })

      describe(`correctly rounds rewards`, () => {
        // Assets
        rewardAmount = parseUnits('1.7', rewardDecimals)

        beforeEach(async () => {
          // Deploy fixture
          ;({ rewardableVault, rewardableAsset, rewardToken } = await loadFixture(fixture))

          await rewardableAsset.mint(alice.address, initBalance)
          await rewardableAsset.connect(alice).approve(rewardableVault.address, MAX_UINT256)
          await rewardableAsset.mint(bob.address, initBalance)
          await rewardableAsset.connect(bob).approve(rewardableVault.address, MAX_UINT256)
        })

        it('Avoids wrong distribution of rewards when rounding', async () => {
          expect(await rewardToken.balanceOf(alice.address)).to.equal(bn(0))
          expect(await rewardToken.balanceOf(bob.address)).to.equal(bn(0))
          expect(await rewardableVault.rewardsPerShare()).to.equal(0)

          // alice deposit and accrue rewards
          await rewardableVault.connect(alice).deposit(initBalance, alice.address)
          await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

          // bob deposit
          await rewardableVault.connect(bob).deposit(initBalance, bob.address)

          // accrue additional rewards (twice the amount)
          await rewardableAsset.accrueRewards(rewardAmount.mul(2), rewardableVault.address)

          // claim all rewards
          await rewardableVault.connect(bob).claimRewards()
          await rewardableVault.connect(alice).claimRewards()

          // Alice got all first rewards plus half of the second
          expect(await rewardToken.balanceOf(alice.address)).to.equal(rewardAmount.mul(2))

          // Bob only got half of the second rewards
          expect(await rewardToken.balanceOf(bob.address)).to.equal(rewardAmount)

          expect(await rewardableVault.rewardsPerShare()).equal(
            rewardAmount.mul(2).mul(oneShare).div(initShares).mul(BN_SHARE_FACTOR)
          )
        })
      })
    })
  }

  const decimalSeeds = [6, 8, 18, 21, 27]
  const cases = cartesianProduct(decimalSeeds, decimalSeeds)
  cases.forEach((params) => {
    const wrapperStr = wrapperName.replace('Test', '')
    describe(`${wrapperStr} - asset decimals: ${params[0]} / reward decimals: ${params[1]}`, () => {
      runTests(params[0], params[1])
    })
  })

  describe(`${wrapperName.replace('Test', '')} Special Case: Fractional Rewards Tracking`, () => {
    // Assets
    let rewardableVault: RewardableERC20WrapperTest | RewardableERC4626VaultTest
    let rewardableAsset: ERC20MockRewarding

    // Main
    let alice: Wallet
    let bob: Wallet

    const initBalance = parseUnits('1000000', 18)
    const rewardAmount = parseUnits('1.9', 6)

    const fixture = getFixture(18, 6)

    before('load wallets', async () => {
      ;[alice, bob] = (await ethers.getSigners()) as unknown as Wallet[]
    })

    beforeEach(async () => {
      // Deploy fixture
      ;({ rewardableVault, rewardableAsset } = await loadFixture(fixture))

      await rewardableAsset.mint(alice.address, initBalance)
      await rewardableAsset.connect(alice).approve(rewardableVault.address, MAX_UINT256)
      await rewardableAsset.mint(bob.address, initBalance)
      await rewardableAsset.connect(bob).approve(rewardableVault.address, MAX_UINT256)
    })

    it('Correctly handles fractional rewards', async () => {
      expect(await rewardableVault.rewardsPerShare()).to.equal(0)

      await rewardableVault.connect(alice).deposit(initBalance, alice.address)

      for (let i = 0; i < 10; i++) {
        await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)
        await rewardableVault.claimRewards()
        expect(await rewardableVault.rewardsPerShare()).to.equal(
          bn(`1.9e${SHARE_DECIMAL_OFFSET}`).mul(i + 1)
        )
      }
    })
  })

  describe(`${wrapperName.replace('Test', '')} Special Case: Rounding - Regression test`, () => {
    // Assets
    let rewardableVault: RewardableERC20WrapperTest | RewardableERC4626VaultTest
    let rewardableAsset: ERC20MockRewarding
    let rewardToken: ERC20MockDecimals
    // Main
    let alice: Wallet
    let bob: Wallet

    const initBalance = parseUnits('1000000', 18)
    const rewardAmount = parseUnits('1.7', 6)

    const fixture = getFixture(18, 6)

    before('load wallets', async () => {
      ;[alice, bob] = (await ethers.getSigners()) as unknown as Wallet[]
    })

    beforeEach(async () => {
      // Deploy fixture
      ;({ rewardableVault, rewardableAsset, rewardToken } = await loadFixture(fixture))

      await rewardableAsset.mint(alice.address, initBalance)
      await rewardableAsset.connect(alice).approve(rewardableVault.address, MAX_UINT256)
      await rewardableAsset.mint(bob.address, initBalance)
      await rewardableAsset.connect(bob).approve(rewardableVault.address, MAX_UINT256)
    })

    it('Avoids wrong distribution of rewards when rounding', async () => {
      expect(await rewardToken.balanceOf(alice.address)).to.equal(bn(0))
      expect(await rewardToken.balanceOf(bob.address)).to.equal(bn(0))
      expect(await rewardableVault.rewardsPerShare()).to.equal(0)

      // alice deposit and accrue rewards
      await rewardableVault.connect(alice).deposit(initBalance, alice.address)
      await rewardableAsset.accrueRewards(rewardAmount, rewardableVault.address)

      // bob deposit
      await rewardableVault.connect(bob).deposit(initBalance, bob.address)

      // accrue additional rewards (twice the amount)
      await rewardableAsset.accrueRewards(rewardAmount.mul(2), rewardableVault.address)

      // claim all rewards
      await rewardableVault.connect(bob).claimRewards()
      await rewardableVault.connect(alice).claimRewards()

      // Alice got all first rewards plus half of the second
      expect(await rewardToken.balanceOf(alice.address)).to.equal(bn(3.4e6))

      // Bob only got half of the second rewards
      expect(await rewardToken.balanceOf(bob.address)).to.equal(bn(1.7e6))

      expect(await rewardableVault.rewardsPerShare()).to.equal(bn(`3.4e${SHARE_DECIMAL_OFFSET}`))
    })
  })

  const IMPLEMENTATION: Implementation =
    useEnv('PROTO_IMPL') == Implementation.P1.toString() ? Implementation.P1 : Implementation.P0

  const describeGas =
    IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

  // This only needs to run once per Wrapper. Should not run for multiple decimal combinations
  describeGas('Gas Reporting', () => {
    // Assets
    let rewardableVault: RewardableERC4626Vault | RewardableERC20Wrapper
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

    describe(wrapperName, () => {
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
          withdraw(rewardableVault.connect(alice), initBalance.div(2), alice.address)
        )

        await snapshotGasCost(
          withdraw(rewardableVault.connect(alice), initBalance.div(2), alice.address)
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
}
