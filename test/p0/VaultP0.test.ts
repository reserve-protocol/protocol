import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { VaultP0 } from '../../typechain/VaultP0'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

interface IAssetInfo {
  erc20: string
  decimals: number
  quantity: BigNumber
}

describe('VaultP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let other: SignerWithAddress

  // Vault
  let VaultFactory: ContractFactory
  let vault: VaultP0

  let ERC20: ContractFactory

  // AAVE, COMP, and Compound mock
  let main: MainP0
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMockP0

  // Tokens/Assets
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: StaticATokenMock
  let token3: CTokenMock

  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: Collateral
  let collateral3: Collateral

  // Basket and Collateral
  let basket: Collateral[]
  let collateral: Collateral[]
  let collateralAddresses: string[]
  let erc20s: ERC20Mock[]

  // Quantities
  let quantities: BigNumber[]
  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ compToken, compoundMock, aaveToken, erc20s, collateral, basket, vault, main } =
      await loadFixture(defaultFixture))

    // Get assets and tokens
    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = basket[2]
    collateral3 = basket[3]
    collateralAddresses = [
      collateral0.address,
      collateral1.address,
      collateral2.address,
      collateral3.address,
    ]

    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())

    // Expected quantities
    quantities = [bn('2.5e17'), bn('2.5e5'), bn('2.5e17'), bn('2.5e7')]

    // Mint tokens
    initialBal = bn('100000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    // Setup Vault Factory
    VaultFactory = await ethers.getContractFactory('VaultP0')

    // Setup Main
    await vault.connect(owner).setMain(main.address)
  })

  describe('Deployment', () => {
    const expectAsset = async (index: number, assetInfo: Partial<IAssetInfo>) => {
      const assetAddress = await vault.collateralAt(index)
      const assetInstance = <CollateralP0>await ethers.getContractAt('CollateralP0', assetAddress)
      expect(await assetInstance.erc20()).to.equal(assetInfo.erc20)
      expect(await assetInstance.decimals()).to.equal(assetInfo.decimals)
      expect(await vault.quantity(assetInstance.address)).to.equal(assetInfo.quantity)
    }

    it('Should setup basket correctly', async () => {
      expect(await vault.size()).to.equal(4)

      // Token at 0
      expectAsset(0, {
        erc20: token0.address,
        decimals: await token0.decimals(),
        quantity: quantities[0],
      })

      // Token at 1
      expectAsset(1, {
        erc20: token1.address,
        decimals: await token1.decimals(),
        quantity: quantities[1],
      })

      // Token at 2
      expectAsset(2, {
        erc20: token2.address,
        decimals: await token2.decimals(),
        quantity: quantities[2],
      })

      // Token at 3
      expectAsset(3, {
        erc20: token3.address,
        decimals: await token3.decimals(),
        quantity: quantities[3],
      })
    })

    it('Should setup backup vaults correctly', async () => {
      // Setup a simple backup vault with single token
      const backupVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral0.address], [quantities[0]], [])
      )
      const newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy(collateralAddresses, quantities, [backupVault.address])
      )

      expect(await newVault.backups(0)).to.equal(backupVault.address)
    })

    it('Should setup owner correctly', async () => {
      expect(await vault.owner()).to.equal(owner.address)
    })

    it('Should revert if basket parameters have different lenght', async () => {
      // Setup a simple backup vault with single token
      await expect(
        VaultFactory.deploy([collateral0.address], [quantities[0], quantities[1]], [])
      ).to.be.revertedWith('arrays must match in length')
    })
  })

  describe('Configuration / State', () => {
    it('Should allow to update Main correctly if Owner', async () => {
      // Setup a new main address
      await vault.connect(owner).setMain(other.address)

      expect(await vault.main()).to.equal(other.address)

      // Try to update again if not owner
      await expect(vault.connect(addr1).setMain(main.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should return quantities for each Asset', async function () {
      expect(await vault.quantity(collateral0.address)).to.equal(quantities[0])
      expect(await vault.quantity(collateral1.address)).to.equal(quantities[1])
      expect(await vault.quantity(collateral2.address)).to.equal(quantities[2])
      expect(await vault.quantity(collateral3.address)).to.equal(quantities[3])

      // If asset does not exist return 0
      expect(await vault.quantity(addr1.address)).to.equal(0)
    })

    it('Should identify if vault containsOnly a list of collateral', async () => {
      // Check if contains only from collaterals
      expect(await vault.connect(owner).containsOnly(collateralAddresses)).to.equal(true)

      expect(
        await vault
          .connect(owner)
          .containsOnly([collateral0.address, collateral1.address, collateral2.address])
      ).to.equal(false)

      expect(await vault.connect(owner).containsOnly([collateral0.address])).to.equal(false)

      // With a smaller vault
      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral0.address], [bn('1e18')], [])
      )
      expect(await newVault.connect(owner).containsOnly(collateralAddresses)).to.equal(true)
      expect(await newVault.connect(owner).containsOnly([collateral0.address])).to.equal(true)
      expect(await newVault.connect(owner).containsOnly([collateral1.address])).to.equal(false)
    })
  })

  describe('Issuance', () => {
    const ONE: BigNumber = bn('1e18')
    const TWO: BigNumber = bn('2e18')
    const qtyHalf: BigNumber = ONE.div(2)
    const qtyHalfSixDecimals: BigNumber = qtyHalf.div(bn('1e12'))

    it('Should not issue BU if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Issue
      await expect(vault.connect(addr1).issue(addr1.address, zero)).to.be.revertedWith(
        'Cannot issue zero'
      )

      // No units created
      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn('1e18')
      await expect(vault.connect(addr1).issue(addr1.address, issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )

      // No units created
      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = bn('5000000e18')
      await expect(vault.connect(addr1).issue(addr1.address, issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))
    })

    it('Should return basketRate and backingAmounts for fiatcoins', async function () {
      // For simple vault with one token (1 to 1)
      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral0.address], [bn('1e18')], [])
      )
      expect(await newVault.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.backingAmounts(ONE)).to.eql([bn('1e18')])

      // For a vault with one token half the value
      newVault = <VaultP0>await VaultFactory.deploy([collateral0.address], [qtyHalf], [])
      expect(await newVault.basketRate()).to.equal(fp(qtyHalf))
      expect(await newVault.backingAmounts(ONE)).to.eql([qtyHalf])

      // For a vault with two token half each, one with six decimals
      newVault = <VaultP0>(
        await VaultFactory.deploy(
          [collateral0.address, collateral1.address],
          [qtyHalf, qtyHalfSixDecimals],
          []
        )
      )
      expect(await newVault.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.backingAmounts(ONE)).to.eql([qtyHalf, qtyHalfSixDecimals])

      // For the vault used by default in these tests (four fiatcoin tokens) - Redemption = 1e18
      expect(await vault.basketRate()).to.equal(fp('1e18'))
      expect(await vault.backingAmounts(ONE)).to.eql(quantities)
      expect(await vault.backingAmounts(TWO)).to.eql(quantities.map((amt) => amt.mul(2)))
    })

    it('Should adjust basketRate and backingAmounts for decimals (USDC)', async function () {
      // New Vault with USDC tokens
      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral1.address], [bn('1e6')], [])
      )
      expect(await newVault.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.backingAmounts(ONE)).to.eql([bn('1e6')])
    })

    it('Should adjust basketRate and backingAmounts for ATokens and CTokens', async function () {
      // Set new Vault with Atokens and CTokens
      const qtyHalfCToken: BigNumber = bn('1e8').div(2)

      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy(
          [collateral2.address, collateral3.address],
          [qtyHalf, qtyHalfCToken],
          []
        )
      )
      expect(await newVault.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.backingAmounts(ONE)).to.eql([qtyHalf, qtyHalfCToken])

      // Change redemption rate for AToken to double (rate increases by an additional half) - In Rays
      await token2.setExchangeRate(fp('2'))
      expect(await newVault.basketRate()).to.equal(fp(bn('1e18').add(qtyHalf)))
      expect(await newVault.backingAmounts(ONE)).to.eql([qtyHalf, qtyHalfCToken])

      // Change also redemption rate for CToken to double (rate doubles)
      await token3.setExchangeRate(fp('2'))
      expect(await newVault.basketRate()).to.equal(fp(bn('1e18').mul(2)))
      expect(await newVault.backingAmounts(ONE)).to.eql([qtyHalf, qtyHalfCToken])

      // Set new Vault with sinlge AToken - reduce redemption rate to a half  - In Rays
      await token2.setExchangeRate(fp('0.5'))
      newVault = <VaultP0>await VaultFactory.deploy([collateral2.address], [bn('1e18')], [])
      expect(await newVault.basketRate()).to.equal(fp(qtyHalf))
      expect(await newVault.backingAmounts(ONE)).to.eql([bn('1e18')])
    })

    it('Should return max Issuable for user', async function () {
      // Calculate max issuable for user with no tokens
      expect(await vault.maxIssuable(owner.address)).to.equal(0)

      // Max issuable for user with tokens (Four times the initial balance)
      expect(await vault.maxIssuable(addr1.address)).to.equal(initialBal.mul(4))

      // Remove that token and recalculate
      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([collateral0.address], [bn('1e18')], [])
      )
      expect(await newVault.maxIssuable(addr1.address)).to.equal(initialBal)
    })

    it('Should issue BUs correctly', async function () {
      const issueAmount: BigNumber = bn('1e18')

      // Approvals
      await token0.connect(addr1).approve(vault.address, quantities[0])
      await token1.connect(addr1).approve(vault.address, quantities[1])
      await token2.connect(addr1).approve(vault.address, quantities[2])
      await token3.connect(addr1).approve(vault.address, quantities[3])

      // Check no balance in contract
      expect(await token0.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await token1.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await token2.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await token3.balanceOf(vault.address)).to.equal(bn('0'))

      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))

      // Issue BUs
      await vault.connect(addr1).issue(addr1.address, issueAmount)

      // Check funds were transferred
      expect(await token0.balanceOf(vault.address)).to.equal(quantities[0])
      expect(await token1.balanceOf(vault.address)).to.equal(quantities[1])
      expect(await token2.balanceOf(vault.address)).to.equal(quantities[2])
      expect(await token3.balanceOf(vault.address)).to.equal(quantities[3])

      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(quantities[0]))
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(quantities[1]))
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(quantities[2]))
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(quantities[3]))

      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })
  })

  describe('Redeem', () => {
    let issueAmount: BigNumber = bn('1e18')

    beforeEach(async () => {
      // Approvals
      await token0.connect(addr1).approve(vault.address, quantities[0])
      await token1.connect(addr1).approve(vault.address, quantities[1])
      await token2.connect(addr1).approve(vault.address, quantities[2])
      await token3.connect(addr1).approve(vault.address, quantities[3])

      // Issue BUs
      await vault.connect(addr1).issue(addr1.address, issueAmount)
    })

    it('Should not redeem BU if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Redeem
      await expect(vault.connect(addr1).redeem(addr1.address, zero)).to.be.revertedWith(
        'Cannot redeem zero'
      )

      // No units redeemed
      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })

    it('Should revert if user does not have the required BUs', async function () {
      const redeemAmount = bn('2e18')

      await expect(vault.connect(addr1).redeem(addr1.address, redeemAmount)).to.be.revertedWith(
        'Not enough units'
      )

      // No units redeemed
      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })

    it('Should redeem BUs correctly', async function () {
      const redeemAmount = bn('1e18')

      // Redeem BUs
      await vault.connect(addr1).redeem(addr1.address, redeemAmount)

      // Check balance after redeem go to initial state
      expect(await token0.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await token1.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await token2.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await token3.balanceOf(vault.address)).to.equal(bn('0'))

      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))
    })
  })

  describe('Rewards', () => {
    const qtyHalf: BigNumber = bn('1e18').div(2)

    it('Should claim and sweep rewards', async function () {
      // Set vault with AToken and CToken
      const qtyHalfCToken: BigNumber = bn('1e8').div(2)

      // Set reward token for the AToken
      await token2.setAaveToken(aaveToken.address)

      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy(
          [collateral2.address, collateral3.address],
          [qtyHalf, qtyHalfCToken],
          []
        )
      )
      // Setup Main
      await newVault.connect(owner).setMain(main.address)

      // Set COMP and AAVE tokens as reward
      const rewardAmountCOMP: BigNumber = bn('100e18')
      const rewardAmountAAVE: BigNumber = bn('20e18')
      await compoundMock.setRewards(newVault.address, rewardAmountCOMP)
      await token2.setRewards(newVault.address, rewardAmountAAVE)

      // Check no funds yet
      expect(await compToken.balanceOf(main.address)).to.equal(0)
      expect(await aaveToken.balanceOf(main.address)).to.equal(0)

      // Claim and Sweep rewards
      await newVault.claimAndSweepRewards()

      // Check rewards were transfered to Asset Manager
      expect(await compToken.balanceOf(await main.address)).to.equal(rewardAmountCOMP)
      expect(await aaveToken.balanceOf(await main.address)).to.equal(rewardAmountAAVE)

      // No funds in vault
      expect(await compToken.balanceOf(newVault.address)).to.equal(0)
      expect(await aaveToken.balanceOf(newVault.address)).to.equal(0)
    })
  })

  describe('Backups', () => {
    let backupVault: VaultP0

    beforeEach(async () => {
      // Setup a simple backup vault with two tokens
      backupVault = <VaultP0>(
        await VaultFactory.deploy(
          [collateral[0].address, collateral[1].address],
          [quantities[0], quantities[1]],
          []
        )
      )
    })

    it('Should not allow to setup backup vaults if not owner', async () => {
      await expect(vault.connect(addr1).setBackups([backupVault.address])).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should allow to setup backup vaults if owner', async () => {
      // Set a new backup with two tokens
      await vault.connect(owner).setBackups([backupVault.address])

      expect(await vault.getBackups()).to.eql([backupVault.address])
      expect(await vault.backups(0)).to.equal(backupVault.address)
    })
  })
})
