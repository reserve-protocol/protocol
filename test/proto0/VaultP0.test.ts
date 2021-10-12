import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory } from 'ethers'
import { bn } from '../../common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { VaultP0 } from '../../typechain/VaultP0'

interface ITokenInfo {
  tokenAddress: string
  quantity: BigNumber
}

describe('VaultP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  let ERC20: ContractFactory
  let VaultFactory: ContractFactory
  let vault: VaultP0
  let tkn0: ERC20Mock
  let tkn1: ERC20Mock
  let tkn2: ERC20Mock
  let tkn3: ERC20Mock
  let tokenInfo0: ITokenInfo
  let tokenInfo1: ITokenInfo
  let tokenInfo2: ITokenInfo
  let tokenInfo3: ITokenInfo
  let basketTokens: ITokenInfo[]
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy RSR and RToken
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
    tkn0.connect(owner).mint(addr1.address, initialBal)
    tkn1.connect(owner).mint(addr1.address, initialBal)
    tkn2.connect(owner).mint(addr1.address, initialBal)
    tkn3.connect(owner).mint(addr1.address, initialBal)

    // Set Basket Tokens
    tokenInfo0 = {
      tokenAddress: tkn0.address,
      quantity: qtyHalf,
    }

    tokenInfo1 = {
      tokenAddress: tkn1.address,
      quantity: qtyHalf,
    }

    tokenInfo2 = {
      tokenAddress: tkn2.address,
      quantity: qtyThird,
    }

    tokenInfo3 = {
      tokenAddress: tkn3.address,
      quantity: qtyDouble,
    }

    basketTokens = [tokenInfo0, tokenInfo1, tokenInfo2, tokenInfo3]

    // Deploy Vault
    VaultFactory = await ethers.getContractFactory('VaultP0')
    vault = <VaultP0>await VaultFactory.deploy(basketTokens)
  })

  describe('Deployment', () => {
    const expectTokenInfo = async (index: number, tokenInfo: Partial<ITokenInfo>) => {
      const { tokenAddress, quantity } = await vault.tokenInfoAt(index)

      expect(tokenAddress).to.equal(tokenInfo.tokenAddress)
      expect(quantity).to.equal(tokenInfo.quantity)
    }

    it('Deployment should setup basket correctly', async () => {
      expect(await vault.basketSize()).to.equal(4)

      // Token at 0
      expectTokenInfo(0, {
        tokenAddress: tokenInfo0.tokenAddress,
        quantity: qtyHalf,
      })

      // Token at 1
      expectTokenInfo(1, {
        tokenAddress: tokenInfo1.tokenAddress,
        quantity: qtyHalf,
      })

      // Token at 2
      expectTokenInfo(2, {
        tokenAddress: tokenInfo2.tokenAddress,
        quantity: qtyThird,
      })

      // Token at 1
      expectTokenInfo(3, {
        tokenAddress: tokenInfo3.tokenAddress,
        quantity: qtyDouble,
      })
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
})
