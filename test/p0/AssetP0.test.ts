import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { fp } from '../../common/numbers'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { VaultP0 } from '../../typechain/VaultP0'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('AssetsP0 contracts', () => {
  let owner: SignerWithAddress

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: RTokenP0

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral
  let rsrAsset: RSRAssetP0
  let compAsset: COMPAssetP0
  let aaveAsset: AAVEAssetP0
  let rTokenAsset: RTokenAssetP0

  // Main and Vault
  let main: MainP0
  let vault: VaultP0

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
    ;({ rsr, rsrAsset, compToken, compAsset, aaveToken, aaveAsset, basket, vault, main, rToken } =
      await loadFixture(defaultFixture))

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

    // Setup Main
    await vault.connect(owner).setMain(main.address)

    // Get RToken Asset
    rTokenAsset = <RTokenAssetP0>(
      await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
    )
  })

  describe('Deployment', () => {
    it('Deployment should setup assets correctly', async () => {
      // Fiat Token Asset
      expect(await tokenAsset.erc20()).to.equal(token.address)
      expect(await tokenAsset.fiatcoin()).to.equal(token.address)
      expect(await tokenAsset.isFiatcoin()).to.equal(true)
      expect(await tokenAsset.isAToken()).to.equal(false)
      expect(await tokenAsset.decimals()).to.equal(await token.decimals())
      expect(await tokenAsset.decimals()).to.equal(18)
      expect(await tokenAsset.fiatcoinDecimals()).to.equal(await token.decimals())
      expect(await tokenAsset.rateFiatcoin()).to.equal(fp('1'))
      expect(await tokenAsset.rateUSD()).to.equal(fp('1'))
      expect(await tokenAsset.priceUSD(await main.oracle())).to.equal(fp('1'))
      expect(await tokenAsset.fiatcoinPriceUSD(await main.oracle())).to.equal(fp('1'))

      // USDC Fiat Token
      expect(await usdcAsset.erc20()).to.equal(usdc.address)
      expect(await usdcAsset.fiatcoin()).to.equal(usdc.address)
      expect(await usdcAsset.isFiatcoin()).to.equal(true)
      expect(await usdcAsset.isAToken()).to.equal(false)
      expect(await usdcAsset.decimals()).to.equal(await usdc.decimals())
      expect(await usdcAsset.decimals()).to.equal(6)
      expect(await usdcAsset.fiatcoinDecimals()).to.equal(await usdc.decimals())
      expect(await usdcAsset.rateFiatcoin()).to.equal(fp('1'))
      expect(await usdcAsset.rateUSD()).to.equal(fp('1e12'))
      expect(await usdcAsset.priceUSD(await main.oracle())).to.equal(fp('1e12'))
      expect(await usdcAsset.fiatcoinPriceUSD(await main.oracle())).to.equal(fp('1e12'))

      // AToken
      expect(await aTokenAsset.erc20()).to.equal(aToken.address)
      expect(await aTokenAsset.fiatcoin()).to.equal(token.address)
      expect(await aTokenAsset.isFiatcoin()).to.equal(false)
      expect(await aTokenAsset.isAToken()).to.equal(true)
      expect(await aTokenAsset.decimals()).to.equal(await aToken.decimals())
      expect(await aTokenAsset.decimals()).to.equal(18)
      expect(await aTokenAsset.fiatcoinDecimals()).to.equal(await token.decimals())
      expect(await aTokenAsset.rateFiatcoin()).to.equal(fp('1'))
      expect(await aTokenAsset.rateUSD()).to.equal(fp('1'))
      expect(await aTokenAsset.priceUSD(await main.oracle())).to.equal(fp('1'))
      expect(await aTokenAsset.fiatcoinPriceUSD(await main.oracle())).to.equal(fp('1'))

      // CToken
      expect(await cTokenAsset.erc20()).to.equal(cToken.address)
      expect(await cTokenAsset.fiatcoin()).to.equal(token.address)
      expect(await cTokenAsset.isFiatcoin()).to.equal(false)
      expect(await cTokenAsset.isAToken()).to.equal(false)
      expect(await cTokenAsset.decimals()).to.equal(await cToken.decimals())
      expect(await cTokenAsset.decimals()).to.equal(8)
      expect(await cTokenAsset.fiatcoinDecimals()).to.equal(await token.decimals())
      expect(await cTokenAsset.rateFiatcoin()).to.equal(fp('1e10'))
      expect(await cTokenAsset.rateUSD()).to.equal(fp('1e10')) // 18 - 8 decimals = 10
      expect(await cTokenAsset.priceUSD(await main.oracle())).to.equal(fp('1e10'))
      expect(await cTokenAsset.fiatcoinPriceUSD(await main.oracle())).to.equal(fp('1'))

      // RSR Asset
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await rsrAsset.decimals()).to.equal(await rsr.decimals())
      expect(await rsrAsset.decimals()).to.equal(18)
      expect(await rsrAsset.priceUSD(await main.oracle())).to.equal(fp('1'))

      // COMP Token
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compAsset.decimals()).to.equal(await compToken.decimals())
      expect(await compAsset.decimals()).to.equal(18)
      expect(await compAsset.priceUSD(await main.oracle())).to.equal(fp('1'))

      // AAVE Token
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveAsset.decimals()).to.equal(await aaveToken.decimals())
      expect(await aaveAsset.decimals()).to.equal(18)
      expect(await aaveAsset.priceUSD(await main.oracle())).to.equal(fp('1'))

      // RToken
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await rTokenAsset.decimals()).to.equal(await rToken.decimals())
      expect(await rTokenAsset.decimals()).to.equal(18)
      expect(await rTokenAsset.priceUSD(await main.oracle())).to.equal(fp('1'))
    })
  })
})
