import { expect } from 'chai'
import { ethers } from 'hardhat'
import { bn, fp } from '../common/numbers'
import { ERC20Mock, MockV3Aggregator, RevenueHidingMock } from '../typechain'
import { CollateralStatus } from '../common/constants'

describe('Revenue hiding', () => {
  // Contracts
  let token: ERC20Mock
  let chainlinkFeed: MockV3Aggregator
  let contract: RevenueHidingMock

  beforeEach(async () => {
    const initialPrice = 1

    const ERC20Factory = await ethers.getContractFactory('ERC20Mock')
    token = <ERC20Mock>await ERC20Factory.deploy('Test Token', 'TTKN')

    const ChainlinkMockFactory = await ethers.getContractFactory('MockV3Aggregator')
    chainlinkFeed = await ChainlinkMockFactory.deploy(8, initialPrice)

    const RevenueHidingMockFactory = await ethers.getContractFactory('RevenueHidingMock')
    contract = await RevenueHidingMockFactory.deploy(
      fp('1'),
      chainlinkFeed.address,
      token.address,
      fp('1e6'), // $1M
      bn('500000000'), // 5700d - large for tests only
      ethers.utils.formatBytes32String('USD'),
      bn('86400'), // 24h
      100 // 1%
    )
  })

  describe('Limits', () => {
    it('Should allow a drop in price smaller than allowed drop', async () => {
      // refresh first time to set cache refPerTok
      await contract.refresh()

      // update the `actualRefPerTok` to an accepted value in the limit
      await contract.updateFakeRefPerTok(fp('0.99'))

      // run refresh
      await contract.refresh()

      // Check that collateral is still SOUND
      expect(await contract.status()).to.equal(CollateralStatus.SOUND)
      expect(await contract.strictPrice()).to.equal('9900000000')
    })

    it('Should default when the drop is bigger than the allowed drop', async () => {
      // refresh first time to set cache refPerTok
      await contract.refresh()

      // update the `actualRefPerTok` with a too low value
      await contract.updateFakeRefPerTok(fp('0.98'))

      // run refresh
      await contract.refresh()

      // Check that collateral defaulted
      expect(await contract.status()).to.equal(CollateralStatus.DISABLED)
      expect(await contract.strictPrice()).to.equal('9800000000')
    })
  })

  describe('Constructor validation', () => {
    it('Should not allow the `allowedDrop` to be bigger or equal than 100', async () => {
      const RevenueHidingMockFactory = await ethers.getContractFactory('RevenueHidingMock')
      await expect(
        RevenueHidingMockFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          token.address,
          fp('1e6'), // $1M
          bn('500000000'), // 5700d - large for tests only
          ethers.utils.formatBytes32String('USD'),
          bn('86400'), // 24h
          10000 // 100%
        )
      ).to.be.revertedWith('Allowed refPerTok drop out of range')
    })
  })
})
