import { ethers } from 'hardhat'
import { bn } from '#/common/numbers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ZERO_ADDRESS } from '#/common/constants'
import { Implementation, IMPLEMENTATION, defaultFixture } from '../fixtures'
import { DAOFeeRegistry, IRToken } from '../../typechain'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1('DAO Fee Registry', () => {
  const veRSRAddr = '0x4d5ef58aAc27d99935E5b6B4A6778ff292059991' // random addr

  let owner: SignerWithAddress
  let other: SignerWithAddress

  let rToken: IRToken

  let feeRegistry: DAOFeeRegistry

  beforeEach(async () => {
    ;[owner, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ rToken } = await loadFixture(defaultFixture))

    const DAOFeeRegistryFactory = await ethers.getContractFactory('DAOFeeRegistry')
    feeRegistry = await DAOFeeRegistryFactory.deploy(await owner.getAddress())
  })

  describe('Deployment', () => {
    it('should set the owner correctly', async () => {
      expect(await feeRegistry.owner()).to.eq(await owner.getAddress())
    })
    it('fee should begin zero', async () => {
      const feeDetails = await feeRegistry.getFeeDetails(rToken.address)
      expect(feeDetails.recipient).to.equal(ZERO_ADDRESS)
      expect(feeDetails.feeNumerator).to.equal(0)
      expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
    })
  })

  describe('Ownership', () => {
    it('Should be able to change owner', async () => {
      expect(await feeRegistry.owner()).to.eq(await owner.getAddress())
      await feeRegistry.connect(owner).transferOwnership(other.address)
      expect(await feeRegistry.owner()).to.eq(await other.getAddress())
      await expect(feeRegistry.connect(owner).setFeeRecipient(veRSRAddr)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(feeRegistry.connect(owner).setDefaultFeeNumerator(bn('100'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(
        feeRegistry.connect(owner).setRTokenFeeNumerator(rToken.address, bn('100'))
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('Negative cases', () => {
    it('Should not allow calling setters by anyone other than owner', async () => {
      await expect(feeRegistry.connect(other).setFeeRecipient(veRSRAddr)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(feeRegistry.connect(other).setDefaultFeeNumerator(bn('100'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(
        feeRegistry.connect(other).setRTokenFeeNumerator(rToken.address, bn('100'))
      ).to.be.revertedWith('Ownable: caller is not the owner')
      await expect(feeRegistry.connect(other).resetRTokenFee(rToken.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should not allow setting fee recipient to zero address', async () => {
      await expect(feeRegistry.connect(owner).setFeeRecipient(ZERO_ADDRESS)).to.be.revertedWith(
        'invalid fee recipient'
      )
    })

    it('Should not allow setting fee recipient twice', async () => {
      await feeRegistry.connect(owner).setFeeRecipient(veRSRAddr)
      await expect(feeRegistry.connect(owner).setFeeRecipient(veRSRAddr)).to.be.revertedWith(
        'already set'
      )
    })

    it('Should not allow fee numerator above max fee numerator', async () => {
      await expect(
        feeRegistry.connect(owner).setDefaultFeeNumerator(bn('15e2').add(1))
      ).to.be.revertedWith('invalid fee numerator')
      await expect(
        feeRegistry.connect(owner).setDefaultFeeNumerator(bn('2').pow(256).sub(1))
      ).to.be.revertedWith('invalid fee numerator')
    })
  })

  describe('Fee Management', () => {
    const defaultFees = [bn('0'), bn('1e3'), bn('15e2')] // test 3 fees: 0%, 10%, 15%
    for (const defaultFee of defaultFees) {
      it('Should handle complex sequence of fee setting and unsetting', async () => {
        await expect(feeRegistry.connect(owner).setDefaultFeeNumerator(defaultFee))
          .to.emit(feeRegistry, 'DefaultFeeNumeratorSet')
          .withArgs(defaultFee)

        // Should be able to set global fee recipient
        await expect(feeRegistry.connect(owner).setFeeRecipient(veRSRAddr))
          .to.emit(feeRegistry, 'FeeRecipientSet')
          .withArgs(veRSRAddr)
        let feeDetails = await feeRegistry.getFeeDetails(rToken.address)
        expect(feeDetails.recipient).to.equal(veRSRAddr)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
        feeDetails = await feeRegistry.getFeeDetails(other.address)
        expect(feeDetails.recipient).to.equal(veRSRAddr)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))

        // Should be able to set precise fee for specific rToken while keeping recipient
        await expect(feeRegistry.connect(owner).setRTokenFeeNumerator(rToken.address, bn('1e3')))
          .to.emit(feeRegistry, 'RTokenFeeNumeratorSet')
          .withArgs(rToken.address, bn('1e3'), true)
        feeDetails = await feeRegistry.getFeeDetails(rToken.address)
        expect(feeDetails.recipient).to.equal(veRSRAddr)
        expect(feeDetails.feeNumerator).to.equal(bn('1e3'))
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
        feeDetails = await feeRegistry.getFeeDetails(other.address)
        expect(feeDetails.recipient).to.equal(veRSRAddr)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))

        // Should be able to change fee recipient while keeping precise fee
        await feeRegistry.setFeeRecipient(other.address)
        feeDetails = await feeRegistry.getFeeDetails(rToken.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(bn('1e3'))
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
        feeDetails = await feeRegistry.getFeeDetails(other.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))

        // Should be able to set fee to 0
        await feeRegistry.setRTokenFeeNumerator(rToken.address, 0)
        feeDetails = await feeRegistry.getFeeDetails(rToken.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(0)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
        feeDetails = await feeRegistry.getFeeDetails(other.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))

        // Should be able to resetFee to use default fee
        await expect(feeRegistry.resetRTokenFee(rToken.address))
          .to.emit(feeRegistry, 'RTokenFeeNumeratorSet')
          .withArgs(rToken.address, 0, false)
        feeDetails = await feeRegistry.getFeeDetails(rToken.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
        feeDetails = await feeRegistry.getFeeDetails(other.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(defaultFee)
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))

        // Should be able to change default fee and update everyone
        await feeRegistry.setDefaultFeeNumerator(bn('5e2')) // 5%
        feeDetails = await feeRegistry.getFeeDetails(rToken.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(bn('5e2'))
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
        feeDetails = await feeRegistry.getFeeDetails(other.address)
        expect(feeDetails.recipient).to.equal(other.address)
        expect(feeDetails.feeNumerator).to.equal(bn('5e2'))
        expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
      })
    }
  })
})
