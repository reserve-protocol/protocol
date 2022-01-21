import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { fp } from '../../common/numbers'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracle } from '../../typechain/AaveOracle'
import { CompoundOracle } from '../../typechain/CompoundOracle'
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
  let compoundOracle: CompoundOracle
  let aaveMock: AaveLendingPoolMockP0
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
    ;({ compoundMock, compoundOracle, aaveMock, aaveOracle, basket, main } = await loadFixture(
      defaultFixture
    ))

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
    it('Oracles should return initial prices correctly', async () => {
      // Compound Oracle
      expect(await compoundOracle.consult(token.address)).to.equal(fp('1e18'))
      expect(await compoundOracle.consult(usdc.address)).to.equal(fp('1e18'))
      expect(await compoundOracle.consult(aToken.address)).to.equal(fp('1e18'))
      expect(await compoundOracle.consult(cToken.address)).to.equal(fp('1e18'))

      // Aave Oracle
      expect(await aaveOracle.consult(token.address)).to.equal(fp('1e18'))
      expect(await aaveOracle.consult(usdc.address)).to.equal(fp('1e18'))
      expect(await aaveOracle.consult(aToken.address)).to.equal(fp('1e18'))
      expect(await aaveOracle.consult(cToken.address)).to.equal(fp('1e18'))
    })

    // TODO: Review
    it.skip('Oracles should return correct prices when CTokens appreciate', async () => {
      // Increase rate for Ctoken to double
      await cToken.setExchangeRate(fp(2))

      // Compound Oracle
      expect(await cTokenAsset.price()).to.equal(fp('2e10'))
      expect(await compoundOracle.consult(cToken.address)).to.equal(fp('1e18'))
    })

    // TODO: Review
    it.skip('Oracles should return correct prices when ATokens appreciate', async () => {
      // Increase rate for Ctoken to double
      await aToken.setExchangeRate(fp(2))

      // Aave Oracle
      expect(await aaveOracle.consult(aToken.address)).to.equal(fp('1e18'))
    })
  })
})
