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

type Fixture<T> = () => Promise<T>

interface RewardableERC20VaultFixture {
    vault: RewardableERC20Vault
    asset: ERC20MockRewarding
    rewardToken: ERC20MockDecimals
    decimals: number
    rewardDecimals: number
}

const fixture: Fixture<RewardableERC20VaultFixture> = async function (): Promise<RewardableERC20VaultFixture> {
  const decimals = 18
  const rewardDecimals = 18

  const rewardTokenFactory: ContractFactory = await ethers.getContractFactory('ERC20MockDecimals')
  const rewardToken = <ERC20MockDecimals>await rewardTokenFactory.deploy("Reward Token", "REWARD", rewardDecimals)
  
  const assetFactory: ContractFactory = await ethers.getContractFactory('ERC20MockRewarding')
  const asset = <ERC20MockRewarding>await assetFactory.deploy("Test Asset", "TEST", decimals, rewardToken.address)

  const vaultFactory: ContractFactory = await ethers.getContractFactory('RewardableERC20VaultTest')
  const vault = <RewardableERC20VaultTest>await vaultFactory.deploy(asset.address, "Test Asset Vault", "vTEST", rewardToken.address)

  return {
      vault,
      asset,
      rewardToken,
      decimals,
      rewardDecimals
  }
}

describe('RewardableERC20Vault #fast', () => {
  // Assets
  let vault: RewardableERC20Vault
  let asset: ERC20MockRewarding
  let rewardToken: ERC20MockDecimals

  // Main
  let alice: Wallet
  let bob: Wallet

  let decimals: number
  let rewardDecimals: number

  let initBalance = fp('10000')
  let rewardAmount = fp('200')
  
  before('create fixture loader', async () => {
    ;[alice, bob] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach(async () => {
    // Deploy fixture
    ;({
      vault,
      asset,
      rewardToken,
      decimals,
      rewardDecimals
    } = await loadFixture(fixture))
    
    initBalance = initBalance.div(bn(10).pow(18 - decimals))
    rewardAmount = rewardAmount.div(bn(10).pow(18 - rewardDecimals))

    await asset.mint(alice.address, initBalance)
    await asset.connect(alice).approve(vault.address, initBalance)
    await asset.mint(bob.address, initBalance)
    await asset.connect(bob).approve(vault.address, initBalance)
  })

  describe('Deployment', () => {
    it("sets the vault asset", async () => {
      const seenAsset = await vault.asset()
      expect(seenAsset).equal(asset.address)
    })

    it("sets the vault reward token", async () => {
      const seenRewardToken = await vault.rewardToken()
      expect(seenRewardToken).equal(rewardToken.address)
    })
  })

  describe("alice deposit, accrue, alice deposit, bob deposit", () => {
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(alice).deposit(initBalance.div(8), alice.address)
  
      // bob deposit
      await vault.connect(bob).deposit(initBalance.div(8), bob.address)

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct balance", async () => {
      expect(initBalance.mul(3).div(8)).equal(await vault.balanceOf(alice.address))
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("bob shows correct balance", async () => {
      expect(initBalance.div(8)).equal(await vault.balanceOf(bob.address))
    })

    it("bob shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })

    it("rewardsPerShare is correct", async () => {
      // rewards / alice's deposit
      expect(rewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)))
    })
  })

  describe("alice deposit, accrue, alice deposit, accrue, bob deposit", () => {
    let rewardsPerShare: BigNumber
    let initRewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)

      initRewardsPerShare = await vault.rewardsPerShare()

      // accrue
      await asset.accrueRewards(rewardAmount, vault.address)

      // bob deposit
      await vault.connect(alice).deposit(initBalance.div(8), bob.address)

      rewardsPerShare = await vault.rewardsPerShare()
    })
    
    it("alice shows correct lastRewardsPerShare", async () => {
      // rewards / alice's deposit
      expect(initRewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)))
      expect(initRewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })
    
    it("bob shows correct lastRewardsPerShare", async () => {
      const expectedRewardsPerShare = rewardAmount.mul(fp(1)).div(initBalance.div(4)).add(rewardAmount.mul(fp(1)).div(initBalance.div(2)))
      expect(rewardsPerShare).equal(expectedRewardsPerShare)
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })
  })

  describe("alice deposit, accrue, alice withdraw", () => {
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(alice).withdraw(initBalance.div(8), alice.address, alice.address)

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("rewardsPerShare is correct", async () => {
      // rewards / alice's deposit
      expect(rewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)))
    })
  })

  describe("alice deposit, accrue, bob deposit, alice withdraw", () => {
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(bob).deposit(initBalance.div(4), bob.address)
      await vault.connect(alice).withdraw(initBalance.div(8), alice.address, alice.address)

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("bob shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })

    it("rewardsPerShare is correct", async () => {
      // rewards / alice's deposit
      expect(rewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)))
    })
  })

  describe("alice deposit, accrue, bob deposit, alice fully withdraw", () => {
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(bob).deposit(initBalance.div(4), bob.address)
      await vault.connect(alice).withdraw(initBalance.div(4), alice.address, alice.address)

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct balance", async () => {
      expect(0).equal(await vault.balanceOf(alice.address))
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("bob shows correct balance", async () => {
      expect(initBalance.div(4)).equal(await vault.balanceOf(bob.address))
    })

    it("bob shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })

    it("rewardsPerShare is correct", async () => {
      // rewards / alice's deposit
      expect(rewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)))
    })
  })

  describe("alice deposit, accrue, alice claim, bob deposit", () => {
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(alice).claimRewards()
  
      // bob deposit
      await vault.connect(bob).deposit(initBalance.div(8), bob.address)

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct balance", async () => {
      expect(initBalance.div(4)).equal(await vault.balanceOf(alice.address))
    })

    it("alice has claimed rewards", async () => {
      expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("bob shows correct balance", async () => {
      expect(initBalance.div(8)).equal(await vault.balanceOf(bob.address))
    })

    it("bob shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })

    it("rewardsPerShare is correct", async () => {
      // rewards / alice's deposit
      expect(rewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)))
    })
  })

  describe("alice deposit, accrue, bob deposit, accrue, bob claim, alice claim", () => {
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
  
      // bob deposit
      await vault.connect(bob).deposit(initBalance.div(4), bob.address)

      // accrue
      await asset.accrueRewards(rewardAmount, vault.address)

      // claims
      await vault.connect(bob).claimRewards()
      await vault.connect(alice).claimRewards()

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct balance", async () => {
      expect(initBalance.div(4)).equal(await vault.balanceOf(alice.address))
    })

    it("alice has claimed rewards", async () => {
      expect(rewardAmount.add(rewardAmount.div(2))).equal(await rewardToken.balanceOf(alice.address))
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("bob shows correct balance", async () => {
      expect(initBalance.div(4)).equal(await vault.balanceOf(bob.address))
    })

    it("bob shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })

    it("bob has claimed rewards", async () => {
      expect(rewardAmount.div(2)).equal(await rewardToken.balanceOf(bob.address))
    })

    it("rewardsPerShare is correct", async () => {
      // (rewards / alice's deposit) + (rewards / (alice's deposit + bob's deposit))
      const expectedRewardsPerShare = rewardAmount.mul(fp(1)).div(initBalance.div(4)).add(rewardAmount.mul(fp(1)).div(initBalance.div(2)))
      expect(rewardsPerShare).equal(expectedRewardsPerShare)
    })
  })

  it("does not accure rewards for an account while it has no deposits", async () => {

  })

  describe("does not accure rewards for an account while it has no deposits", () => {
    // alice deposit, accrue, bob deposit, alice fully withdraw, accrue, alice deposit, alice claim, bob claim
    let rewardsPerShare: BigNumber

    beforeEach(async () => {
      // alice deposit, accrue, and claim
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(bob).deposit(initBalance.div(4), bob.address)
      await vault.connect(alice).withdraw(initBalance.div(4), alice.address, alice.address)
      await asset.accrueRewards(rewardAmount, vault.address)
      await vault.connect(alice).deposit(initBalance.div(4), alice.address)
      await vault.connect(bob).claimRewards()
      await vault.connect(alice).claimRewards()

      rewardsPerShare = await vault.rewardsPerShare()
    })

    it("alice shows correct balance", async () => {
      expect(initBalance.div(4)).equal(await vault.balanceOf(alice.address))
    })

    it("alice shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(alice.address))
    })

    it("alice has claimed rewards", async () => {
      expect(rewardAmount).equal(await rewardToken.balanceOf(alice.address))
    })

    it("bob shows correct balance", async () => {
      expect(initBalance.div(4)).equal(await vault.balanceOf(bob.address))
    })

    it("bob shows correct lastRewardsPerShare", async () => {
      expect(rewardsPerShare).equal(await vault.lastRewardsPerShare(bob.address))
    })

    it("bob has claimed rewards", async () => {
      expect(rewardAmount).equal(await rewardToken.balanceOf(bob.address))
    })

    it("rewardsPerShare is correct", async () => {
      // (rewards / alice's deposit) + (rewards / bob's deposit)
      expect(rewardsPerShare).equal(rewardAmount.mul(fp(1)).div(initBalance.div(4)).mul(2))
    })
  })
})
