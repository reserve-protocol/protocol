import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import { AaveOracle } from '../../typechain/AaveOracle'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AssetP0 } from '../../typechain/AssetP0'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('AssetsP0 contracts', () => {
  let owner: SignerWithAddress
  let other: SignerWithAddress

  // Tokens
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: RTokenP0

  // Assets
  let rsrAsset: AssetP0
  let compAsset: AssetP0
  let aaveAsset: AssetP0
  let rTokenAsset: RTokenAssetP0

  // Oracles
  let compoundOracle: CompoundOracle
  let compoundOracleInternal: CompoundOracleMockP0
  let aaveOracle: AaveOracle
  let aaveOracleInternal: AaveOracleMockP0

  // Main
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      compAsset,
      compoundOracleInternal,
      compoundOracle,
      aaveToken,
      aaveAsset,
      aaveOracleInternal,
      aaveOracle,
      main,
      rToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))
  })

  describe('Deployment', () => {
    it('Deployment should setup assets correctly', async () => {
      // RSR Asset
      expect(await rsrAsset.main()).to.equal(main.address)
      expect(await rsrAsset.oracle()).to.equal(aaveOracle.address)
      expect(await rsrAsset.isCollateral()).to.equal(false)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await rsr.decimals()).to.equal(18)
      expect(await rsrAsset.price()).to.equal(fp('1'))

      // COMP Token
      expect(await compAsset.main()).to.equal(main.address)
      expect(await compAsset.oracle()).to.equal(compoundOracle.address)
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.price()).to.equal(fp('1'))

      // AAVE Token
      expect(await aaveAsset.main()).to.equal(main.address)
      expect(await aaveAsset.oracle()).to.equal(aaveOracle.address)
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.price()).to.equal(fp('1'))

      // RToken
      expect(await rTokenAsset.main()).to.equal(main.address)
      expect(await rTokenAsset.oracle()).to.equal(aaveOracle.address)
      expect(await rTokenAsset.isCollateral()).to.equal(false)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await rToken.decimals()).to.equal(18)
      expect(await rTokenAsset.price()).to.equal(fp('1'))
    })
  })

  describe('Prices', () => {
    it('Should calculate price correctly', async () => {
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
    })
  })

  describe('Configuration', () => {
    it('Should allow to set Oracle if Owner', async () => {
      // Check initial status
      expect(await rsrAsset.oracle()).to.equal(aaveOracle.address)

      // Try to update with another user
      await expect(rsrAsset.connect(other).setOracle(compoundOracle.address)).to.be.revertedWith(
        'only main.owner'
      )

      // Check nothing changed
      expect(await rsrAsset.oracle()).to.equal(aaveOracle.address)

      // Update with owner
      await rsrAsset.connect(owner).setOracle(compoundOracle.address)

      expect(await rsrAsset.oracle()).to.equal(compoundOracle.address)
    })
  })
})
