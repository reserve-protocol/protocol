import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory } from 'ethers'
import { bn } from '../../common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { Collateral } from '../../typechain/Collateral'
import { VaultP0 } from '../../typechain/VaultP0'

interface ICollateralInfo {
  erc20: string
  decimals: number
  quantity: BigNumber
}

describe('VaultP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  let ERC20: ContractFactory
  let VaultFactory: ContractFactory
  let vault: VaultP0
  let tkn0: ERC20Mock
  let tkn1: ERC20Mock
  let tkn2: ERC20Mock
  let tkn3: ERC20Mock
  let CollateralFactory: ContractFactory
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: Collateral
  let collateral3: Collateral
  let quantity0: BigNumber
  let quantity1: BigNumber
  let quantity2: BigNumber
  let quantity3: BigNumber
  let collaterals: string[]
  let quantities: BigNumber[]
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy Tokens
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    tkn0 = <ERC20Mock>await ERC20.deploy('Token 0', 'TKN0')
    tkn1 = <ERC20Mock>await ERC20.deploy('Token 1', 'TKN1')
    tkn2 = <ERC20Mock>await ERC20.deploy('Token 2', 'TKN2')
    tkn3 = <ERC20Mock>await ERC20.deploy('Token 3', 'TKN2')

    // Set initial amounts and set quantities
    initialBal = bn(100e18)
    qtyHalf = bn(1e18).div(2)
    qtyThird = bn(1e18).div(3)
    qtyDouble = bn(1e18).mul(2)

    // Mint tokens
    await tkn0.connect(owner).mint(addr1.address, initialBal)
    await tkn1.connect(owner).mint(addr1.address, initialBal)
    await tkn2.connect(owner).mint(addr1.address, initialBal)
    await tkn3.connect(owner).mint(addr1.address, initialBal)

    // Set Collaterals and Quantities
    CollateralFactory = await ethers.getContractFactory('Collateral')
    collateral0 = <Collateral>await CollateralFactory.deploy(tkn0.address, tkn0.decimals())
    collateral1 = <Collateral>await CollateralFactory.deploy(tkn1.address, tkn0.decimals())
    collateral2 = <Collateral>await CollateralFactory.deploy(tkn2.address, tkn0.decimals())
    collateral3 = <Collateral>await CollateralFactory.deploy(tkn3.address, tkn0.decimals())

    quantity0 = qtyHalf
    quantity1 = qtyHalf
    quantity2 = qtyThird
    quantity3 = qtyDouble

    collaterals = [collateral0.address, collateral1.address, collateral2.address, collateral3.address]
    quantities = [quantity0, quantity1, quantity2, quantity3]

    // Deploy Main Vault
    VaultFactory = await ethers.getContractFactory('VaultP0')
    vault = <VaultP0>await VaultFactory.deploy(collaterals, quantities, [])
  })

  describe('Deployment', () => {
    const expectCollateral = async (index: number, collateralInfo: Partial<ICollateralInfo>) => {
      const collateralAddress = await vault.collateralAt(index)
      const collateralInstance = await ethers.getContractAt('Collateral', collateralAddress)
      expect(await collateralInstance.erc20()).to.equal(collateralInfo.erc20)
      expect(await collateralInstance.decimals()).to.equal(collateralInfo.decimals)
      expect(await vault.quantity(collateralInstance.address)).to.equal(collateralInfo.quantity)
    }

    it('Deployment should setup basket correctly', async () => {
      expect(await vault.basketSize()).to.equal(4)
      expect(await vault.getBackups()).to.be.empty

      // Token at 0
      expectCollateral(0, {
        erc20: tkn0.address,
        decimals: await tkn0.decimals(),
        quantity: qtyHalf,
      })

      // Token at 1
      expectCollateral(1, {
        erc20: tkn1.address,
        decimals: await tkn1.decimals(),
        quantity: qtyHalf,
      })

      // Token at 2
      expectCollateral(2, {
        erc20: tkn2.address,
        decimals: await tkn2.decimals(),
        quantity: qtyThird,
      })

      // Token at 3
      expectCollateral(3, {
        erc20: tkn3.address,
        decimals: await tkn3.decimals(),
        quantity: qtyDouble,
      })
    })

    it('Deployment should setup backup vaults correctly', async () => {
      // Setup a simple backup vault with single token
      const backupVault: VaultP0 = <VaultP0>await VaultFactory.deploy([collaterals[0]], [quantities[0]], [])
      const newVault: VaultP0 = <VaultP0>await VaultFactory.deploy(collaterals, quantities, [backupVault.address])

      expect((await newVault.getBackups()).length).to.equal(1)
      expect(await newVault.backups(0)).to.equal(backupVault.address)
    })
  })

  describe('Issuance', () => {
    it('Should not issue BU if amount is zero', async function () {
      const zero: BigNumber = bn(0)

      // Issue
      await expect(vault.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      // No units created
      expect(await vault.totalUnits()).to.equal(bn(0))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn(0))
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn(1e18)
      await expect(vault.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )

      // No units created
      expect(await vault.totalUnits()).to.equal(bn(0))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn(0))
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = bn(10000e18)
      await expect(vault.connect(addr1).issue(issueAmount)).to.be.revertedWith('ERC20: transfer amount exceeds balance')

      expect(await vault.totalUnits()).to.equal(bn(0))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn(0))
    })

    it('Should issue BUs correctly', async function () {
      const issueAmount: BigNumber = bn(1e18)

      // Approvals
      await tkn0.connect(addr1).approve(vault.address, qtyHalf)
      await tkn1.connect(addr1).approve(vault.address, qtyHalf)
      await tkn2.connect(addr1).approve(vault.address, qtyThird)
      await tkn3.connect(addr1).approve(vault.address, qtyDouble)

      // Check no balance in contract
      expect(await tkn0.balanceOf(vault.address)).to.equal(bn(0))
      expect(await tkn1.balanceOf(vault.address)).to.equal(bn(0))
      expect(await tkn2.balanceOf(vault.address)).to.equal(bn(0))
      expect(await tkn3.balanceOf(vault.address)).to.equal(bn(0))

      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await vault.totalUnits()).to.equal(bn(0))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn(0))

      // Issue BUs
      await vault.connect(addr1).issue(issueAmount)

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
    let issueAmount: BigNumber = bn(1e18)

    beforeEach(async () => {
      // Approvals
      await tkn0.connect(addr1).approve(vault.address, qtyHalf)
      await tkn1.connect(addr1).approve(vault.address, qtyHalf)
      await tkn2.connect(addr1).approve(vault.address, qtyThird)
      await tkn3.connect(addr1).approve(vault.address, qtyDouble)

      // Issue BUs
      await vault.connect(addr1).issue(issueAmount)
    })

    it('Should not redeem BU if amount is zero', async function () {
      const zero: BigNumber = bn(0)

      // Redeem
      await expect(vault.connect(addr1).redeem(addr1.address, zero)).to.be.revertedWith('Cannot redeem zero')

      // No units redeemed
      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })

    it('Should revert if user does not have the required BUs', async function () {
      const redeemAmount = bn(2e18)

      await expect(vault.connect(addr1).redeem(addr1.address, redeemAmount)).to.be.revertedWith('Not enough units')

      // No units redeemed
      expect(await vault.totalUnits()).to.equal(issueAmount)
      expect(await vault.basketUnits(addr1.address)).to.equal(issueAmount)
    })

    it('Should redeem BUs correctly', async function () {
      const redeemAmount = bn(1e18)

      // Redeem BUs
      await vault.connect(addr1).redeem(addr1.address, redeemAmount)

      // Check balance after redeem go to initial state
      expect(await tkn0.balanceOf(vault.address)).to.equal(bn(0))
      expect(await tkn1.balanceOf(vault.address)).to.equal(bn(0))
      expect(await tkn2.balanceOf(vault.address)).to.equal(bn(0))
      expect(await tkn3.balanceOf(vault.address)).to.equal(bn(0))

      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await vault.totalUnits()).to.equal(bn(0))
      expect(await vault.basketUnits(addr1.address)).to.equal(bn(0))
    })
  })

  describe('Backups', () => {
    let backupVault: VaultP0

    beforeEach(async () => {
      // Setup a simple backup vault with two tokens
      backupVault = <VaultP0>(
        await VaultFactory.deploy([collaterals[0], collaterals[1]], [quantities[0], quantities[1]], [])
      )
    })

    it('Should not allow to setup backup vaults if not owner', async () => {
      await expect(vault.connect(addr1).setBackups([backupVault.address])).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      expect(await vault.getBackups()).to.be.empty
    })

    it('Should allow to setup backup vaults if owner', async () => {
      // Set a new backup with two tokens
      await vault.connect(owner).setBackups([backupVault.address])

      expect((await vault.getBackups()).length).to.equal(1)
      expect(await vault.backups(0)).to.equal(backupVault.address)
    })
  })
})
