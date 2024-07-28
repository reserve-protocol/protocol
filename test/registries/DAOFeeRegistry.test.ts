import { ethers } from 'hardhat'
import { bn } from '#/common/numbers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ZERO_ADDRESS } from '#/common/constants'
import { Implementation, IMPLEMENTATION, defaultFixture } from '../fixtures'
import { whileImpersonating } from '../utils/impersonation'
import {
  DAOFeeRegistry,
  ERC20Mock,
  TestIDistributor,
  TestIRevenueTrader,
  TestIMain,
  IRToken,
} from '../../typechain'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1('DAO Fee Registry', () => {
  let owner: SignerWithAddress
  let other: SignerWithAddress

  let distributor: TestIDistributor
  let main: TestIMain
  let rToken: IRToken
  let rsr: ERC20Mock
  let rsrTrader: TestIRevenueTrader

  let feeRegistry: DAOFeeRegistry

  beforeEach(async () => {
    ;[owner, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ distributor, main, rToken, rsr, rsrTrader } = await loadFixture(defaultFixture))

    const mockRoleRegistryFactory = await ethers.getContractFactory('MockRoleRegistry')
    const mockRoleRegistry = await mockRoleRegistryFactory.deploy()

    const DAOFeeRegistryFactory = await ethers.getContractFactory('DAOFeeRegistry')
    feeRegistry = await DAOFeeRegistryFactory.connect(owner).deploy(
      mockRoleRegistry.address,
      await owner.getAddress()
    )

    await main.connect(owner).setDAOFeeRegistry(feeRegistry.address)
  })

  describe('Deployment', () => {
    it('fee should begin zero and assigned to owner', async () => {
      const feeDetails = await feeRegistry.getFeeDetails(rToken.address)
      expect(feeDetails.recipient).to.equal(owner.address)
      expect(feeDetails.feeNumerator).to.equal(0)
      expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
    })
  })

  describe('Negative cases', () => {
    it('Should not allow calling setters by anyone other than owner', async () => {
      await expect(feeRegistry.connect(other).setFeeRecipient(owner.address)).to.be.revertedWith(
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
      await expect(
        feeRegistry.connect(owner).setFeeRecipient(ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(feeRegistry, 'DAOFeeRegistry__InvalidFeeRecipient')
    })

    it('Should not allow setting fee recipient twice', async () => {
      await expect(
        feeRegistry.connect(owner).setFeeRecipient(owner.address)
      ).to.be.revertedWithCustomError(feeRegistry, 'DAOFeeRegistry__FeeRecipientAlreadySet')
    })

    it('Should not allow fee numerator above max fee numerator', async () => {
      await expect(
        feeRegistry.connect(owner).setDefaultFeeNumerator(bn('15e2').add(1))
      ).to.be.revertedWithCustomError(feeRegistry, 'DAOFeeRegistry__InvalidFeeNumerator')
      await expect(
        feeRegistry.connect(owner).setDefaultFeeNumerator(bn('2').pow(256).sub(1))
      ).to.be.revertedWithCustomError(feeRegistry, 'DAOFeeRegistry__InvalidFeeNumerator')
    })
  })

  describe('Fee Management', () => {
    const defaultFees = [bn('0'), bn('1e3'), bn('15e2')] // test 3 fees: 0%, 10%, 15%
    for (const defaultFee of defaultFees) {
      context(`Default Fee: ${defaultFee.div(100).toString()}%`, () => {
        beforeEach(async () => {
          await expect(feeRegistry.connect(owner).setDefaultFeeNumerator(defaultFee))
            .to.emit(feeRegistry, 'DefaultFeeNumeratorSet')
            .withArgs(defaultFee)
        })

        it('Should handle complex sequence of fee setting and unsetting', async () => {
          // Should start out as expected
          let feeDetails = await feeRegistry.getFeeDetails(rToken.address)
          expect(feeDetails.recipient).to.equal(owner.address)
          expect(feeDetails.feeNumerator).to.equal(defaultFee)
          expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
          feeDetails = await feeRegistry.getFeeDetails(other.address)
          expect(feeDetails.recipient).to.equal(owner.address)
          expect(feeDetails.feeNumerator).to.equal(defaultFee)
          expect(feeDetails.feeDenominator).to.equal(bn('1e4'))

          // Should be able to set precise fee for specific rToken while keeping recipient
          await expect(feeRegistry.connect(owner).setRTokenFeeNumerator(rToken.address, bn('1e3')))
            .to.emit(feeRegistry, 'RTokenFeeNumeratorSet')
            .withArgs(rToken.address, bn('1e3'), true)
          feeDetails = await feeRegistry.getFeeDetails(rToken.address)
          expect(feeDetails.recipient).to.equal(owner.address)
          expect(feeDetails.feeNumerator).to.equal(bn('1e3'))
          expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
          feeDetails = await feeRegistry.getFeeDetails(other.address)
          expect(feeDetails.recipient).to.equal(owner.address)
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

        if (defaultFee.gt(0)) {
          it('Distributor distributions should reflect the fee', async () => {
            // Check setup
            const feeDetails = await feeRegistry.getFeeDetails(rToken.address)
            expect(feeDetails.recipient).to.equal(owner.address)
            expect(feeDetails.feeNumerator).to.equal(defaultFee)
            expect(feeDetails.feeDenominator).to.equal(bn('1e4'))
            expect(await rsr.balanceOf(rsrTrader.address)).to.equal(0)

            // Distribute 1m RSR
            const amt = bn('1e24')
            await rsr.mint(rsrTrader.address, amt)
            await whileImpersonating(rsrTrader.address, async (signer) => {
              await rsr.connect(signer).approve(distributor.address, amt)
              expect(await rsr.balanceOf(owner.address)).to.equal(0)
              await distributor.connect(signer).distribute(rsr.address, amt)

              // Expected returned amount is for the fee times 5/3 to account for rev share split
              const expectedAmt = amt.mul(defaultFee).div(bn('1e4')).mul(5).div(3)
              expect(await rsr.balanceOf(owner.address)).to.equal(expectedAmt)
            })
          })
        }
      })
    }
  })
})
