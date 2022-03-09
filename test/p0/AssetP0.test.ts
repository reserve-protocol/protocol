import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveOracleMockP0,
  AssetP0,
  CompoundOracleMockP0,
  ERC20Mock,
  RTokenAssetP0,
  RTokenP0,
  USDCMock,
} from '../../typechain'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('AssetsP0 contracts', () => {
  // Tokens
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: RTokenP0

  // Tokens/Assets
  let token0: ERC20Mock
  let token1: ERC20Mock

  // Assets
  let rsrAsset: AssetP0
  let compAsset: AssetP0
  let aaveAsset: AssetP0
  let rTokenAsset: RTokenAssetP0

  // Oracles
  let compoundOracleInternal: CompoundOracleMockP0
  let aaveOracleInternal: AaveOracleMockP0

  // Config
  let config: IConfig

  // Main
  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const amt = fp('1e4')

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    let basket: Collateral[]

      // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      compAsset,
      compoundOracleInternal,
      aaveToken,
      aaveAsset,
      aaveOracleInternal,
      basket,
      config,
      rToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await basket[0].erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await basket[1].erc20())

    await rsr.connect(wallet).mint(wallet.address, amt)
    await compToken.connect(wallet).mint(wallet.address, amt)
    await aaveToken.connect(wallet).mint(wallet.address, amt)

    for (let i = 0; i < basket.length; i++) {
      const tok = await ethers.getContractAt('ERC20Mock', await basket[i].erc20())
      await tok.connect(wallet).mint(wallet.address, amt)
      await tok.connect(wallet).approve(rToken.address, amt)
    }
    await rToken.connect(wallet).issue(amt)
  })

  describe('Deployment', () => {
    it('Deployment should setup assets correctly', async () => {
      // RSR Asset
      expect(await rsrAsset.isCollateral()).to.equal(false)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await rsr.decimals()).to.equal(18)
      expect(await rsrAsset.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await rsrAsset.bal(wallet.address)).to.equal(amt)
      expect(await rsrAsset.balQ(wallet.address)).to.equal(amt.mul(bn('1e18')))
      expect(await rsrAsset.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await rsrAsset.price()).to.equal(fp('1'))

      // COMP Token
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await compAsset.bal(wallet.address)).to.equal(amt)
      expect(await compAsset.balQ(wallet.address)).to.equal(amt.mul(bn('1e18')))
      expect(await compAsset.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await compAsset.price()).to.equal(fp('1'))

      // AAVE Token
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await aaveAsset.bal(wallet.address)).to.equal(amt)
      expect(await aaveAsset.balQ(wallet.address)).to.equal(amt.mul(bn('1e18')))
      expect(await aaveAsset.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await aaveAsset.price()).to.equal(fp('1'))

      // RToken
      expect(await rTokenAsset.isCollateral()).to.equal(false)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await rToken.decimals()).to.equal(18)
      expect(await rTokenAsset.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await rTokenAsset.bal(wallet.address)).to.equal(amt)
      expect(await rTokenAsset.balQ(wallet.address)).to.equal(amt.mul(bn('1e18')))
      expect(await rTokenAsset.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await rTokenAsset.price()).to.equal(fp('1'))
      expect(await rTokenAsset.price()).to.equal(await rToken.price())
    })
  })

  describe('Prices', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await rsrAsset.price()).to.equal(fp('1'))
      expect(await compAsset.price()).to.equal(fp('1'))
      expect(await aaveAsset.price()).to.equal(fp('1'))
      expect(await rTokenAsset.price()).to.equal(fp('1'))

      // Update values in Oracles increase by 10-20%
      await compoundOracleInternal.setPrice('COMP', bn('1.1e6')) // 10%
      await aaveOracleInternal.setPrice(aaveToken.address, bn('3e14')) // 20%
      await aaveOracleInternal.setPrice(compToken.address, bn('2.75e14')) // 10%
      await aaveOracleInternal.setPrice(rsr.address, bn('3e14')) // 20%

      // Check new prices
      expect(await rsrAsset.price()).to.equal(fp('1.2'))
      expect(await compAsset.price()).to.equal(fp('1.1'))
      expect(await aaveAsset.price()).to.equal(fp('1.2'))
      expect(await rTokenAsset.price()).to.equal(fp('1')) // No changes
      expect(await rTokenAsset.price()).to.equal(await rToken.price())
    })

    it('Should calculate RToken price correctly', async () => {
      // Check initial price
      expect(await rTokenAsset.price()).to.equal(fp('1'))

      // Update values of underlying tokens - increase all by 10%
      await aaveOracleInternal.setPrice(token0.address, bn('2.75e14')) // 10%
      await aaveOracleInternal.setPrice(token1.address, bn('2.75e14')) // 10%
      await compoundOracleInternal.setPrice(await token0.symbol(), bn('1.1e6')) // 10%
      await compoundOracleInternal.setPrice(await token1.symbol(), bn('1.1e6')) // 10%

      // Price of RToken should increase by 10%
      expect(await rTokenAsset.price()).to.equal(fp('1.1'))
      expect(await rTokenAsset.price()).to.equal(await rToken.price())
    })

    it('Should revert if price is zero', async () => {
      // Update values in Oracles to 0
      await compoundOracleInternal.setPrice('COMP', bn(0))
      await aaveOracleInternal.setPrice(aaveToken.address, bn(0))
      await aaveOracleInternal.setPrice(compToken.address, bn(0))
      await aaveOracleInternal.setPrice(rsr.address, bn(0))

      // Check new prices
      // RSR
      let symbol: string = await rsr.symbol()
      await expect(rsrAsset.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)

      // COMP
      symbol = await compToken.symbol()
      await expect(compAsset.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)

      // AAVE
      symbol = await aaveToken.symbol()
      await expect(aaveAsset.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)
    })
  })
})
