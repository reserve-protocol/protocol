import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory } from 'ethers'
import { bn, fp } from '../../common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { CTokenMock } from '../../typechain/CTokenMock'
import { AssetP0 } from '../../typechain/AssetP0'
import { ATokenAssetP0 } from '../../typechain/ATokenAssetP0'
import { CTokenAssetP0 } from '../../typechain/CTokenAssetP0'
import { MainMockP0 } from '../../typechain/MainMockP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { USDCMock } from '../../typechain/USDCMock'

describe('AssetP0 contracts', () => {
  let owner: SignerWithAddress

  // Tokens
  let ERC20: ContractFactory
  let USDCMockFactory: ContractFactory
  let ATokenMockFactory: ContractFactory
  let CTokenMockFactory: ContractFactory

  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let rsr: ERC20Mock
  let comp: ERC20Mock
  let aave: ERC20Mock

  // Assets
  let AssetFactory: ContractFactory
  let AAssetFactory: ContractFactory
  let CAssetFactory: ContractFactory
  let RSRAssetFactory: ContractFactory
  let AAVEAssetFactory: ContractFactory
  let COMPAssetFactory: ContractFactory
  let tokenAsset: AssetP0
  let usdcAsset: AssetP0
  let aTokenAsset: ATokenAssetP0
  let cTokenAsset: CTokenAssetP0
  let rsrAsset: RSRAssetP0
  let compAsset: COMPAssetP0
  let aaveAsset: AAVEAssetP0

  // Main Mock
  let MainMockFactory: ContractFactory
  let main: MainMockP0

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // Deploy underlying tokens
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    USDCMockFactory = await ethers.getContractFactory('USDCMock')
    ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
    CTokenMockFactory = await ethers.getContractFactory('CTokenMock')

    token = <ERC20Mock>await ERC20.deploy('Token', 'TKN')
    usdc = <USDCMock>await USDCMockFactory.deploy('USDC Token', 'USDC')
    aToken = <StaticATokenMock>await ATokenMockFactory.deploy('Static AToken', 'aTKN', token.address)
    cToken = <CTokenMock>await CTokenMockFactory.deploy('CToken', 'cTKN', usdc.address)
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')
    comp = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')
    aave = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')

    // Deploy Assets
    AssetFactory = await ethers.getContractFactory('AssetP0')
    tokenAsset = <AssetP0>await AssetFactory.deploy(token.address)
    usdcAsset = <AssetP0>await AssetFactory.deploy(usdc.address)

    AAssetFactory = await ethers.getContractFactory('ATokenAssetP0')
    aTokenAsset = <ATokenAssetP0>await AAssetFactory.deploy(aToken.address)

    CAssetFactory = await ethers.getContractFactory('CTokenAssetP0')
    cTokenAsset = <CTokenAssetP0>await CAssetFactory.deploy(cToken.address)

    RSRAssetFactory = await ethers.getContractFactory('RSRAssetP0')
    rsrAsset = <RSRAssetP0>await RSRAssetFactory.deploy(rsr.address)

    COMPAssetFactory = await ethers.getContractFactory('COMPAssetP0')
    compAsset = <COMPAssetP0>await COMPAssetFactory.deploy(comp.address)

    AAVEAssetFactory = await ethers.getContractFactory('AAVEAssetP0')
    aaveAsset = <AAVEAssetP0>await AAVEAssetFactory.deploy(aave.address)

    // Deploy Main Mock
    MainMockFactory = await ethers.getContractFactory('MainMockP0')
    main = <MainMockP0>await MainMockFactory.deploy(rsr.address, bn('0'))
  })

  describe('Deployment', () => {
    it('Deployment should setup assets correctly', async () => {
      // TODO: Add `rateUSD` for top 4

      // Fiat Token Asset
      expect(await tokenAsset.erc20()).to.equal(token.address)
      expect(await tokenAsset.fiatcoin()).to.equal(token.address)
      expect(await tokenAsset.isFiatcoin()).to.equal(true)
      expect(await tokenAsset.decimals()).to.equal(await token.decimals())
      expect(await tokenAsset.decimals()).to.equal(18)
      expect(await tokenAsset.fiatcoinDecimals()).to.equal(await token.decimals())
      expect(await tokenAsset.callStatic.rateFiatcoin()).to.equal(fp('1'))
      expect(await tokenAsset.callStatic.rateUSD()).to.equal(fp('1'))
      expect(await tokenAsset.callStatic.priceUSD(main.address)).to.equal(fp('1'))
      expect(await tokenAsset.fiatcoinPriceUSD(main.address)).to.equal(fp('1'))

      // USDC Fiat Token
      expect(await usdcAsset.erc20()).to.equal(usdc.address)
      expect(await usdcAsset.fiatcoin()).to.equal(usdc.address)
      expect(await usdcAsset.isFiatcoin()).to.equal(true)
      expect(await usdcAsset.decimals()).to.equal(await usdc.decimals())
      expect(await usdcAsset.decimals()).to.equal(6)
      expect(await usdcAsset.fiatcoinDecimals()).to.equal(await usdc.decimals())
      expect(await usdcAsset.callStatic.rateFiatcoin()).to.equal(fp('1'))
      expect(await usdcAsset.callStatic.rateUSD()).to.equal(fp('1e12'))
      expect(await usdcAsset.callStatic.priceUSD(main.address)).to.equal(fp('1e12'))
      expect(await usdcAsset.fiatcoinPriceUSD(main.address)).to.equal(fp('1e12'))

      // AToken
      expect(await aTokenAsset.erc20()).to.equal(aToken.address)
      expect(await aTokenAsset.fiatcoin()).to.equal(token.address)
      expect(await aTokenAsset.isFiatcoin()).to.equal(false)
      expect(await aTokenAsset.decimals()).to.equal(await aToken.decimals())
      expect(await aTokenAsset.decimals()).to.equal(18)
      expect(await aTokenAsset.fiatcoinDecimals()).to.equal(await token.decimals())
      expect(await aTokenAsset.callStatic.rateFiatcoin()).to.equal(fp('1'))
      expect(await aTokenAsset.callStatic.rateUSD()).to.equal(fp('1'))
      expect(await aTokenAsset.callStatic.priceUSD(main.address)).to.equal(fp('1'))
      expect(await aTokenAsset.fiatcoinPriceUSD(main.address)).to.equal(fp('1'))

      // CToken
      expect(await cTokenAsset.erc20()).to.equal(cToken.address)
      expect(await cTokenAsset.fiatcoin()).to.equal(usdc.address)
      expect(await cTokenAsset.isFiatcoin()).to.equal(false)
      expect(await cTokenAsset.decimals()).to.equal(await cToken.decimals())
      expect(await cTokenAsset.decimals()).to.equal(8)
      expect(await cTokenAsset.fiatcoinDecimals()).to.equal(await usdc.decimals())
      expect(await cTokenAsset.callStatic.rateFiatcoin()).to.equal(fp('1e-2')) // 1/100 qUSDC per qcUSDC
      expect(await cTokenAsset.callStatic.rateUSD()).to.equal(fp('1e10'))
      expect(await cTokenAsset.callStatic.priceUSD(main.address)).to.equal(fp('1e10')) // 18 - 8 decimals = 10
      expect(await cTokenAsset.fiatcoinPriceUSD(main.address)).to.equal(fp('1e12'))

      // RSR Asset
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await rsrAsset.fiatcoin()).to.equal(rsr.address)
      expect(await rsrAsset.isFiatcoin()).to.equal(false)
      expect(await rsrAsset.decimals()).to.equal(await rsr.decimals())
      expect(await rsrAsset.decimals()).to.equal(18)
      expect(await rsrAsset.fiatcoinDecimals()).to.equal(await rsr.decimals())
      expect(await rsrAsset.callStatic.priceUSD(main.address)).to.equal(fp('1'))
      await expect(rsrAsset.callStatic.rateFiatcoin()).to.be.reverted
      await expect(rsrAsset.callStatic.rateUSD()).to.be.reverted
      await expect(rsrAsset.fiatcoinPriceUSD(main.address)).to.be.reverted

      // COMP Token
      expect(await compAsset.erc20()).to.equal(comp.address)
      expect(await compAsset.fiatcoin()).to.equal(comp.address)
      expect(await compAsset.isFiatcoin()).to.equal(false)
      expect(await compAsset.decimals()).to.equal(await comp.decimals())
      expect(await compAsset.decimals()).to.equal(18)
      expect(await compAsset.fiatcoinDecimals()).to.equal(await comp.decimals())
      expect(await compAsset.callStatic.priceUSD(main.address)).to.equal(fp('1'))
      await expect(compAsset.callStatic.rateFiatcoin()).to.be.reverted
      await expect(compAsset.callStatic.rateUSD()).to.be.reverted
      await expect(compAsset.fiatcoinPriceUSD(main.address)).to.be.reverted

      // AAVE Token
      expect(await aaveAsset.erc20()).to.equal(aave.address)
      expect(await aaveAsset.fiatcoin()).to.equal(aave.address)
      expect(await aaveAsset.isFiatcoin()).to.equal(false)
      expect(await aaveAsset.decimals()).to.equal(await aave.decimals())
      expect(await aaveAsset.decimals()).to.equal(18)
      expect(await aaveAsset.fiatcoinDecimals()).to.equal(await aave.decimals())
      expect(await aaveAsset.callStatic.priceUSD(main.address)).to.equal(fp('1'))
      await expect(aaveAsset.callStatic.rateFiatcoin()).to.be.reverted
      await expect(aaveAsset.callStatic.rateUSD()).to.be.reverted
      await expect(aaveAsset.fiatcoinPriceUSD(main.address)).to.be.reverted
    })
  })
})
