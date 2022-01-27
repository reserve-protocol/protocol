import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracle } from '../../typechain/AaveOracle'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('OracleP0 contract', () => {
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
  let compoundMock: ComptrollerMockP0
  let compoundOracleInternal: CompoundOracleMockP0
  let compoundOracle: CompoundOracle
  let aaveMock: AaveLendingPoolMockP0
  let aaveOracleInternal: AaveOracleMockP0
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
    ;({
      compoundMock,
      compoundOracleInternal,
      compoundOracle,
      aaveMock,
      aaveOracleInternal,
      aaveOracle,
      basket,
      main,
    } = await loadFixture(defaultFixture))

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
    it('Deployment should setup Oracles correctly', async () => {
      // Compound Oracle
      expect(await compoundOracle.comptroller()).to.equal(compoundMock.address)

      // Aave Oracle
      expect(await aaveOracle.comptroller()).to.equal(compoundMock.address)
      expect(await aaveOracle.aaveLendingPool()).to.equal(aaveMock.address)
    })
  })

  describe('Prices', () => {
    it('Should return initial prices correctly', async () => {
      // Compound Oracle
      expect(await compoundOracle.consult(token.address)).to.equal(fp('1'))
      expect(await compoundOracle.consult(usdc.address)).to.equal(fp('1'))
      expect(await compoundOracle.consult(aToken.address)).to.equal(fp('1'))
      expect(await compoundOracle.consult(cToken.address)).to.equal(fp('1'))

      // Aave Oracle
      expect(await aaveOracle.consult(token.address)).to.equal(fp('1'))
      expect(await aaveOracle.consult(usdc.address)).to.equal(fp('1'))
      expect(await aaveOracle.consult(aToken.address)).to.equal(fp('1'))
      expect(await aaveOracle.consult(cToken.address)).to.equal(fp('1'))
    })

    it('Should return correct prices for fiat Tokens', async () => {
      // Increase price of fiat Token by 20%
      await aaveOracleInternal.setPrice(token.address, bn('3e14'))
      expect(await aaveOracle.consult(token.address)).to.equal(fp('1.2'))

      // Increase price of 6-decimal fiat Token by 10%
      await aaveOracleInternal.setPrice(usdc.address, bn('2.75e14'))
      expect(await aaveOracle.consult(usdc.address)).to.equal(fp('1.1'))
    })

    it('Should revert if price is zero', async () => {
      // Set price of token to 0 in both oracles
      await aaveOracleInternal.setPrice(token.address, bn('0'))
      await compoundOracleInternal.setPrice(await token.symbol(), bn('0'))

      // Check price of token
      await expect(aaveOracle.consult(token.address)).to.be.revertedWith(
        `PriceIsZero("${await token.symbol()}")`
      )
      await expect(compoundOracle.consult(token.address)).to.be.revertedWith(
        `PriceIsZero("${await token.symbol()}")`
      )
    })

    // TODO: Review if this is valid or no price should be defined
    it.skip('Should return same price for ATokens/CTokens even if underlying changes', async () => {
      // Increase price of underlying for CToken by 10%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('1.1e6'))
      expect(await compoundOracle.consult(cToken.address)).to.equal(fp('1'))

      // Increase price of underlying for AToken by 10%
      await aaveOracleInternal.setPrice(token.address, bn('2.75e14'))
      expect(await aaveOracle.consult(aToken.address)).to.equal(fp('1'))
    })

    // TODO: Review if this is valid or no price should be defined
    it.skip('Should return same price when ATokens/CTokens appreciate', async () => {
      // Increase rate for AToken and Ctoken to double
      await aToken.setExchangeRate(fp(2))
      await cToken.setExchangeRate(fp(2))

      // Compound Oracle
      expect(await compoundOracle.consult(cToken.address)).to.equal(fp('1'))

      // Aave Oracle
      expect(await aaveOracle.consult(aToken.address)).to.equal(fp('1'))
    })
  })
})
