import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { CollateralStatus } from '../../common/constants'
import { fp } from '../../common/numbers'
import { AaveOracle } from '../../typechain/AaveOracle'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('CollateralP0 contracts', () => {
  let owner: SignerWithAddress

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Oracles
  let compoundOracle: CompoundOracle
  let aaveOracle: AaveOracle

  // Main
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    let basket: Collateral[]

      // Deploy fixture
    ;({ compoundOracle, aaveOracle, basket, main } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = basket[0]
    usdcAsset = basket[1]
    aTokenAsset = basket[2]
    cTokenAsset = basket[3]
    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())
  })

  describe('Deployment', () => {
    it('Deployment should setup collateral correctly', async () => {
      // Fiat Token Asset
      expect(await tokenAsset.main()).to.equal(main.address)
      expect(await tokenAsset.oracle()).to.equal(aaveOracle.address)
      expect(await tokenAsset.isCollateral()).to.equal(true)
      expect(await tokenAsset.erc20()).to.equal(token.address)
      expect(await token.decimals()).to.equal(18)
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      // TODO Test for score() + quantity()
      expect(await tokenAsset.price()).to.equal(fp('1'))

      // USDC Fiat Token
      expect(await usdcAsset.main()).to.equal(main.address)
      expect(await usdcAsset.oracle()).to.equal(aaveOracle.address)
      expect(await usdcAsset.isCollateral()).to.equal(true)
      expect(await usdcAsset.erc20()).to.equal(usdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      // TODO Test for score() + quantity()
      expect(await usdcAsset.price()).to.equal(fp('1e12'))

      // AToken
      expect(await aTokenAsset.main()).to.equal(main.address)
      expect(await aTokenAsset.oracle()).to.equal(aaveOracle.address)
      expect(await aTokenAsset.isCollateral()).to.equal(true)
      expect(await aTokenAsset.erc20()).to.equal(aToken.address)
      expect(await aToken.decimals()).to.equal(18)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      // TODO Test for score() + quantity()
      expect(await aTokenAsset.price()).to.equal(fp('1'))

      // CToken
      expect(await cTokenAsset.main()).to.equal(main.address)
      expect(await cTokenAsset.oracle()).to.equal(compoundOracle.address)
      expect(await cTokenAsset.isCollateral()).to.equal(true)
      expect(await cTokenAsset.erc20()).to.equal(cToken.address)
      expect(await cToken.decimals()).to.equal(8)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      // TODO Test for score() + quantity()
      expect(await cTokenAsset.price()).to.equal(fp('1e10'))
    })
  })
})
