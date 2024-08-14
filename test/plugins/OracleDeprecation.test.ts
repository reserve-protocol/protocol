import { Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { fp } from '../../common/numbers'
import { ERC20Mock, TestIRToken } from '../../typechain'
import { Collateral, DefaultFixture, defaultFixture } from '../fixtures'
import { expect } from 'chai'

describe('Chainlink Oracle', () => {
  // Tokens
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: TestIRToken

  // Assets
  let basket: Collateral[]

  let wallet: Wallet

  const amt = fp('1e4')
  let fixture: DefaultFixture

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach(async () => {
    // Deploy fixture
    fixture = await loadFixture(defaultFixture)
    ;({ rsr, compToken, aaveToken, basket, rToken } = fixture)

    // Get collateral tokens
    await rsr.connect(wallet).mint(wallet.address, amt)
    await compToken.connect(wallet).mint(wallet.address, amt)
    await aaveToken.connect(wallet).mint(wallet.address, amt)

    // Issue RToken to enable RToken.price
    for (let i = 0; i < basket.length; i++) {
      const tok = await ethers.getContractAt('ERC20Mock', await basket[i].erc20())
      await tok.connect(wallet).mint(wallet.address, amt)
      await tok.connect(wallet).approve(rToken.address, amt)
    }
    await rToken.connect(wallet).issue(amt)
  })

  // Expected behavior on deprecation
  //  - Chainlink: latestRoundData() reverts and aggregator == address(0)
  //  - Redstone:  latestRoundData() does not revert, only signal is outdated price
  //  - Chronicle: latestRoundData() does not revert, but price is set to 0
  describe('Chainlink/Chronicle deprecates an asset', () => {
    it('Refresh should mark the asset as IFFY', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const [, aUSDCCollateral] = fixture.bySymbol.ausdc
      const chainLinkOracle = MockV3AggregatorFactory.attach(await aUSDCCollateral.chainlinkFeed())
      await aUSDCCollateral.refresh()
      await aUSDCCollateral.tryPrice()
      expect(await aUSDCCollateral.status()).to.equal(0)
      await chainLinkOracle.deprecate()
      await aUSDCCollateral.refresh()
      expect(await aUSDCCollateral.status()).to.equal(1)
      await expect(aUSDCCollateral.tryPrice()).to.be.revertedWithCustomError(
        aUSDCCollateral,
        'StalePrice'
      )
    })

    it('Price = 0 should mark the asset as IFFY (Chronicle)', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const [, aUSDCCollateral] = fixture.bySymbol.ausdc
      const chainLinkOracle = MockV3AggregatorFactory.attach(await aUSDCCollateral.chainlinkFeed())
      await aUSDCCollateral.refresh()
      await aUSDCCollateral.tryPrice()
      expect(await aUSDCCollateral.status()).to.equal(0)
      await chainLinkOracle.updateAnswer(0)
      await aUSDCCollateral.refresh()
      expect(await aUSDCCollateral.status()).to.equal(1)
      await expect(aUSDCCollateral.tryPrice()).to.be.revertedWithCustomError(
        aUSDCCollateral,
        'InvalidPrice'
      )
    })
  })
})
