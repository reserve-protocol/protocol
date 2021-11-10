import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory } from 'ethers'
import { bn, fp } from '../../common/numbers'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { USDCMock } from '../../typechain/USDCMock'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { CTokenMock } from '../../typechain/CTokenMock'
import { AssetP0 } from '../../typechain/AssetP0'
import { ATokenAssetP0 } from '../../typechain/ATokenAssetP0'
import { CTokenAssetP0 } from '../../typechain/CTokenAssetP0'
import { VaultP0 } from '../../typechain/VaultP0'
import { MainMockP0 } from '../../typechain/MainMockP0'

interface IAssetInfo {
  erc20: string
  decimals: number
  quantity: BigNumber
}

describe('VaultP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Vault
  let VaultFactory: ContractFactory
  let vault: VaultP0

  let ERC20: ContractFactory

  // RSR and Main mock
  let MainMockFactory: ContractFactory
  let main: MainMockP0
  let rsr: ERC20Mock

  // Tokens/Assets
  let USDCMockFactory: ContractFactory
  let tkn0: ERC20Mock
  let tkn1: ERC20Mock
  let tkn2: ERC20Mock
  let tkn3: ERC20Mock
  let usdc: USDCMock

  let AssetFactory: ContractFactory
  let asset0: AssetP0
  let asset1: AssetP0
  let asset2: AssetP0
  let asset3: AssetP0
  let assetUSDC: AssetP0
  let assets: string[]

  // AToken and CTokens
  let ATokenMockFactory: ContractFactory
  let CTokenMockFactory: ContractFactory
  let ATokenAssetFactory: ContractFactory
  let CTokenAssetFactory: ContractFactory
  let aTkn: StaticATokenMock
  let cTkn: CTokenMock
  let assetAToken: ATokenAssetP0
  let assetCToken: CTokenAssetP0

  // Quantities
  let quantity0: BigNumber
  let quantity1: BigNumber
  let quantity2: BigNumber
  let quantity3: BigNumber
  let quantities: BigNumber[]
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber

  const ONE: BigNumber = bn('1e18')
  const TWO: BigNumber = bn('2e18')

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy RSR
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')

    // Deploy Main Mock
    MainMockFactory = await ethers.getContractFactory('MainMockP0')
    main = <MainMockP0>await MainMockFactory.deploy(rsr.address, bn('0'))

    // Deploy Tokens
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    tkn0 = <ERC20Mock>await ERC20.deploy('Token 0', 'TKN0')
    tkn1 = <ERC20Mock>await ERC20.deploy('Token 1', 'TKN1')
    tkn2 = <ERC20Mock>await ERC20.deploy('Token 2', 'TKN2')
    tkn3 = <ERC20Mock>await ERC20.deploy('Token 3', 'TKN2')

    USDCMockFactory = await ethers.getContractFactory('USDCMock')
    usdc = <USDCMock>await USDCMockFactory.deploy('USDC Dollar', 'USDC')

    // Set initial amounts and set quantities
    initialBal = bn('100000e18')
    qtyHalf = bn('1e18').div(2)
    qtyThird = bn('1e18').div(3)
    qtyDouble = bn('1e18').mul(2)

    // Mint tokens
    await tkn0.connect(owner).mint(addr1.address, initialBal)
    await tkn1.connect(owner).mint(addr1.address, initialBal)
    await tkn2.connect(owner).mint(addr1.address, initialBal)
    await tkn3.connect(owner).mint(addr1.address, initialBal)

    // Set Collateral Assets and Quantities
    AssetFactory = await ethers.getContractFactory('AssetP0')
    asset0 = <AssetP0>await AssetFactory.deploy(tkn0.address, tkn0.decimals())
    asset1 = <AssetP0>await AssetFactory.deploy(tkn1.address, tkn1.decimals())
    asset2 = <AssetP0>await AssetFactory.deploy(tkn2.address, tkn2.decimals())
    asset3 = <AssetP0>await AssetFactory.deploy(tkn3.address, tkn3.decimals())
    assetUSDC = <AssetP0>await AssetFactory.deploy(usdc.address, usdc.decimals())

    // ATokens and CTokens
    ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
    aTkn = <StaticATokenMock>await ATokenMockFactory.deploy('AToken', 'ATKN0', tkn0.address)
    ATokenAssetFactory = await ethers.getContractFactory('ATokenAssetP0')
    assetAToken = <ATokenAssetP0>await ATokenAssetFactory.deploy(aTkn.address, aTkn.decimals())

    CTokenMockFactory = await ethers.getContractFactory('CTokenMock')
    cTkn = <CTokenMock>await CTokenMockFactory.deploy('CToken', 'CTKN1', tkn1.address)
    CTokenAssetFactory = await ethers.getContractFactory('CTokenAssetP0')
    assetCToken = <CTokenAssetP0>await CTokenAssetFactory.deploy(cTkn.address, cTkn.decimals())

    // Quantities
    quantity0 = qtyHalf
    quantity1 = qtyHalf
    quantity2 = qtyThird
    quantity3 = qtyDouble

    assets = [asset0.address, asset1.address, asset2.address, asset3.address]
    quantities = [quantity0, quantity1, quantity2, quantity3]

    VaultFactory = await ethers.getContractFactory('VaultP0')
    vault = <VaultP0>await VaultFactory.deploy(assets, quantities, [])

    // Setup Main
    await vault.connect(owner).setMain(main.address)
  })

  describe('Deployment', () => {
    const expectAsset = async (index: number, assetInfo: Partial<IAssetInfo>) => {
      const assetAddress = await vault.assetAt(index)
      const assetInstance = <AssetP0>await ethers.getContractAt('AssetP0', assetAddress)
      expect(await assetInstance.erc20()).to.equal(assetInfo.erc20)
      expect(await assetInstance.decimals()).to.equal(assetInfo.decimals)
      expect(await vault.quantity(assetInstance.address)).to.equal(assetInfo.quantity)
    }

    it('Should setup basket correctly', async () => {
      expect(await vault.size()).to.equal(4)

      // Token at 0
      expectAsset(0, {
        erc20: tkn0.address,
        decimals: await tkn0.decimals(),
        quantity: qtyHalf,
      })

      // Token at 1
      expectAsset(1, {
        erc20: tkn1.address,
        decimals: await tkn1.decimals(),
        quantity: qtyHalf,
      })

      // Token at 2
      expectAsset(2, {
        erc20: tkn2.address,
        decimals: await tkn2.decimals(),
        quantity: qtyThird,
      })

      // Token at 3
      expectAsset(3, {
        erc20: tkn3.address,
        decimals: await tkn3.decimals(),
        quantity: qtyDouble,
      })
    })

    it('Should setup backup vaults correctly', async () => {
      // Setup a simple backup vault with single token
      const backupVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assets[0]], [quantities[0]], [])
      const newVault: VaultP0 = <VaultP0>await VaultFactory.deploy(assets, quantities, [backupVault.address])

      expect(await newVault.backups(0)).to.equal(backupVault.address)
    })

    it('Should setup owner correctly', async () => {
      expect(await vault.owner()).to.equal(owner.address)
    })

    it('Should revert if basket parameters have different lenght', async () => {
      // Setup a simple backup vault with single token
      await expect(VaultFactory.deploy([assets[0]], [quantities[0], quantities[1]], [])).to.be.revertedWith(
        'arrays must match in length'
      )
    })
  })

  describe('Configuration / State', () => {
    it('Should allow to update Main correctly if Owner', async () => {
      // Create a new Main mock
      const newMain: MainMockP0 = <MainMockP0>await MainMockFactory.deploy(rsr.address, bn('0'))

      await vault.connect(owner).setMain(newMain.address)

      expect(await vault.main()).to.equal(newMain.address)

      // Try to update again if not owner
      await expect(vault.connect(addr1).setMain(main.address)).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should return quantities for each Asset', async function () {
      expect(await vault.quantity(assets[0])).to.equal(qtyHalf)
      expect(await vault.quantity(assets[1])).to.equal(qtyHalf)
      expect(await vault.quantity(assets[2])).to.equal(qtyThird)
      expect(await vault.quantity(assets[3])).to.equal(qtyDouble)

      // If asset does not exist return 0
      expect(await vault.quantity(addr1.address)).to.equal(0)
    })

    it('Should identify if vault containsOnly a list of collateral', async () => {
      // Check if contains only from collaterals
      expect(await vault.connect(owner).containsOnly(assets)).to.equal(true)

      expect(await vault.connect(owner).containsOnly([assets[0], assets[1], assets[2]])).to.equal(false)

      expect(await vault.connect(owner).containsOnly([assets[0]])).to.equal(false)

      // With a smaller vault
      let newVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assets[0]], [bn('1e18')], [])
      expect(await newVault.connect(owner).containsOnly(assets)).to.equal(true)
      expect(await newVault.connect(owner).containsOnly([assets[0]])).to.equal(true)
      expect(await newVault.connect(owner).containsOnly([assets[1]])).to.equal(false)
    })
  })

  describe('Issuance', () => {
    it('Should not issue BU if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Issue
      await expect(vault.connect(addr1).issue(addr1.address, zero)).to.be.revertedWith('Cannot issue zero')

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

    it('Should return basketRate and tokenAmounts for fiatcoins', async function () {
      // For simple vault with one token (1 to 1)
      let newVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assets[0]], [bn('1e18')], [])
      expect(await newVault.callStatic.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.tokenAmounts(ONE)).to.eql([bn('1e18')])

      // For a vault with one token half the value
      newVault = <VaultP0>await VaultFactory.deploy([assets[0]], [qtyHalf], [])
      expect(await newVault.callStatic.basketRate()).to.equal(fp(qtyHalf))
      expect(await newVault.tokenAmounts(ONE)).to.eql([qtyHalf])

      // For a vault with two token half each
      newVault = <VaultP0>await VaultFactory.deploy([assets[0], assets[1]], [qtyHalf, qtyHalf], [])
      expect(await newVault.callStatic.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.tokenAmounts(ONE)).to.eql([qtyHalf, qtyHalf])

      // For the vault used by default in these tests (four fiatcoin tokens) - Redemption = 1e18
      expect(await vault.callStatic.basketRate()).to.equal(fp(qtyHalf.mul(2).add(qtyThird.add(qtyDouble))))
      expect(await vault.tokenAmounts(ONE)).to.eql([qtyHalf, qtyHalf, qtyThird, qtyDouble])
      expect(await vault.tokenAmounts(TWO)).to.eql([qtyHalf.mul(2), qtyHalf.mul(2), qtyThird.mul(2), qtyDouble.mul(2)])
    })

    it('Should adjust basketRate and tokenAmounts for decimals (USDC)', async function () {
      // New Vault with USDC tokens
      let newVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assetUSDC.address], [bn('1e6')], [])
      expect(await newVault.callStatic.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.tokenAmounts(ONE)).to.eql([bn('1e6')])
    })

    it('Should adjust basketRate and tokenAmounts for ATokens and CTokens', async function () {
      // Set new Vault with Atokens and CTokens
      const qtyHalfCToken: BigNumber = bn('1e8').div(2)

      let newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy([assetAToken.address, assetCToken.address], [qtyHalf, qtyHalfCToken], [])
      )
      expect(await newVault.callStatic.basketRate()).to.equal(fp('1e18'))
      expect(await newVault.tokenAmounts(ONE)).to.eql([qtyHalf, qtyHalfCToken])

      // Change redemption rate for AToken to double (rate increases by an additional half) - In Rays
      await aTkn.setExchangeRate(bn('2e27'))
      expect(await newVault.callStatic.basketRate()).to.equal(fp(bn('1e18').add(qtyHalf)))
      expect(await newVault.tokenAmounts(ONE)).to.eql([qtyHalf, qtyHalfCToken])

      // Change also redemption rate for CToken to double (rate doubles)
      // By default the current exchange rate at genesis is 2e26 for CTokens
      await cTkn.setExchangeRate(bn('4e26'))
      expect(await newVault.callStatic.basketRate()).to.equal(fp(bn('1e18').mul(2)))
      expect(await newVault.tokenAmounts(ONE)).to.eql([qtyHalf, qtyHalfCToken])

      // Set new Vault with sinlge AToken - reduce redemption rate to a half  - In Rays
      await aTkn.setExchangeRate(bn('5e26'))
      newVault = <VaultP0>await VaultFactory.deploy([assetAToken.address], [bn('1e18')], [])
      expect(await newVault.callStatic.basketRate()).to.equal(fp(qtyHalf))
      expect(await newVault.tokenAmounts(ONE)).to.eql([bn('1e18')])
    })

    it('Should return max Issuable for user', async function () {
      // Calculate max issuable for user with no tokens
      expect(await vault.maxIssuable(owner.address)).to.equal(0)

      // Max issuable for user with tokens (Half of balance because a token requires qtyDouble)
      expect(await vault.maxIssuable(addr1.address)).to.equal(initialBal.div(2).div(BN_SCALE_FACTOR))

      // Remove that token and recalculate
      let newVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assets[0]], [bn('1e18')], [])
      expect(await newVault.maxIssuable(addr1.address)).to.equal(initialBal.div(BN_SCALE_FACTOR))
    })

    it('Should issue BUs correctly', async function () {
      const issueAmount: BigNumber = bn('1e18')

      // Approvals
      await tkn0.connect(addr1).approve(vault.address, qtyHalf)
      await tkn1.connect(addr1).approve(vault.address, qtyHalf)
      await tkn2.connect(addr1).approve(vault.address, qtyThird)
      await tkn3.connect(addr1).approve(vault.address, qtyDouble)

      // Check no balance in contract
      expect(await tkn0.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await tkn1.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await tkn2.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await tkn3.balanceOf(vault.address)).to.equal(bn('0'))

      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))

      // Issue BUs
      await vault.connect(addr1).issue(addr1.address, issueAmount)

      // Check funds were transferred
      expect(await tkn0.balanceOf(vault.address)).to.equal(qtyHalf)
      expect(await tkn1.balanceOf(vault.address)).to.equal(qtyHalf)
      expect(await tkn2.balanceOf(vault.address)).to.equal(qtyThird)
      expect(await tkn3.balanceOf(vault.address)).to.equal(qtyDouble)

      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal.sub(qtyHalf))
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal.sub(qtyHalf))
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal.sub(qtyThird))
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal.sub(qtyDouble))

      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })
  })

  describe('Redeem', () => {
    let issueAmount: BigNumber = bn('1e18')

    beforeEach(async () => {
      // Approvals
      await tkn0.connect(addr1).approve(vault.address, qtyHalf)
      await tkn1.connect(addr1).approve(vault.address, qtyHalf)
      await tkn2.connect(addr1).approve(vault.address, qtyThird)
      await tkn3.connect(addr1).approve(vault.address, qtyDouble)

      // Issue BUs
      await vault.connect(addr1).issue(addr1.address, issueAmount)
    })

    it('Should not redeem BU if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Redeem
      await expect(vault.connect(addr1).redeem(addr1.address, zero)).to.be.revertedWith('Cannot redeem zero')

      // No units redeemed
      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })

    it('Should revert if user does not have the required BUs', async function () {
      const redeemAmount = bn('2e18')

      await expect(vault.connect(addr1).redeem(addr1.address, redeemAmount)).to.be.revertedWith('Not enough units')

      // No units redeemed
      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })

    it('Should redeem BUs correctly', async function () {
      const redeemAmount = bn('1e18')

      // Redeem BUs
      await vault.connect(addr1).redeem(addr1.address, redeemAmount)

      // Check balance after redeem go to initial state
      expect(await tkn0.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await tkn1.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await tkn2.balanceOf(vault.address)).to.equal(bn('0'))
      expect(await tkn3.balanceOf(vault.address)).to.equal(bn('0'))

      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await vault.totalUnits()).to.equal(bn('0'))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn('0'))
    })
  })

  describe('Rewards', () => {
    it.skip('Should claim and sweep rewards to Manager', async function () {
      // Claim and Sweep rewards
      // TODO: Load or mock main, with Comptroller. Review how to implement `claimComp` in mock.
      //await vault.claimAndSweepRewardsToManager(main.address)
    })
  })

  describe('Backups', () => {
    let backupVault: VaultP0

    beforeEach(async () => {
      // Setup a simple backup vault with two tokens
      backupVault = <VaultP0>await VaultFactory.deploy([assets[0], assets[1]], [quantities[0], quantities[1]], [])
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
