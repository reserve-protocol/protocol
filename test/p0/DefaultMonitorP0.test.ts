import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { BN_SCALE_FACTOR, ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DefaultMonitorP0 } from '../../typechain/DefaultMonitorP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainMockP0 } from '../../typechain/MainMockP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { VaultP0 } from '../../typechain/VaultP0'

describe('DefaultMonitorP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Vault
  let VaultFactory: ContractFactory
  let vault: VaultP0

  // Default Monitor
  let DefaultMonitorFactory: ContractFactory
  let defaultMonitor: DefaultMonitorP0

  // Oracles
  let compoundOracle: CompoundOracleMockP0
  let aaveOracle: AaveOracleMockP0
  let weth: ERC20Mock

  let ERC20: ContractFactory

  // RSR, AAVE, COMP, and Main mock
  let MainMockFactory: ContractFactory
  let main: MainMockP0
  let rsr: ERC20Mock
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock

  // Tokens/Assets
  let USDCMockFactory: ContractFactory
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: ERC20Mock
  let token3: ERC20Mock
  let usdc: USDCMock

  let AssetFactory: ContractFactory
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: CollateralP0
  let collateral3: CollateralP0
  let collateralUSDC: CollateralP0
  let collateral: string[]
  let defaulting: string[]

  // AToken and CTokens
  let ATokenMockFactory: ContractFactory
  let CTokenMockFactory: ContractFactory
  let ATokenAssetFactory: ContractFactory
  let CTokenAssetFactory: ContractFactory
  let aTkn: StaticATokenMock
  let cTkn: CTokenMock
  let assetAToken: ATokenCollateralP0
  let assetCToken: CTokenCollateralP0

  // Quantities
  let quantity0: BigNumber
  let quantity1: BigNumber
  let quantity2: BigNumber
  let quantity3: BigNumber
  let quantities: BigNumber[]
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy RSR
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')

    // Deploy AAVE and COMP Tokens (for Rewards)
    aaveToken = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')
    compToken = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')

    // Deploy WETH (for Oracle)
    weth = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')

    // Deploy Main Mock

    MainMockFactory = await ethers.getContractFactory('MainMockP0')
    const defaultThreshold: BigNumber = fp('0.05')
    main = <MainMockP0>(
      await MainMockFactory.deploy(
        rsr.address,
        compToken.address,
        aaveToken.address,
        weth.address,
        bn('0'),
        defaultThreshold
      )
    )

    // Deploy Tokens
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    token0 = <ERC20Mock>await ERC20.deploy('Token 0', 'TKN0')
    token1 = <ERC20Mock>await ERC20.deploy('Token 1', 'TKN1')
    token2 = <ERC20Mock>await ERC20.deploy('Token 2', 'TKN2')
    token3 = <ERC20Mock>await ERC20.deploy('Token 3', 'TKN2')

    USDCMockFactory = await ethers.getContractFactory('USDCMock')
    usdc = <USDCMock>await USDCMockFactory.deploy('USDC Dollar', 'USDC')

    // Set initial amounts and set quantities
    initialBal = bn('100000e18')
    qtyHalf = bn('1e18').div(2)
    qtyThird = bn('1e18').div(3)
    qtyDouble = bn('1e18').mul(2)

    // Mint tokens
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    // Set Collateral Assets and Quantities
    AssetFactory = await ethers.getContractFactory('CollateralP0')
    collateral0 = <CollateralP0>await AssetFactory.deploy(token0.address, token0.decimals())
    collateral1 = <CollateralP0>await AssetFactory.deploy(token1.address, token1.decimals())
    collateral2 = <CollateralP0>await AssetFactory.deploy(token2.address, token2.decimals())
    collateral3 = <CollateralP0>await AssetFactory.deploy(token3.address, token3.decimals())
    collateralUSDC = <CollateralP0>await AssetFactory.deploy(usdc.address, usdc.decimals())

    // ATokens and CTokens
    ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
    aTkn = <StaticATokenMock>await ATokenMockFactory.deploy('AToken', 'ATKN0', token0.address)
    ATokenAssetFactory = await ethers.getContractFactory('ATokenCollateralP0')
    assetAToken = <ATokenCollateralP0>await ATokenAssetFactory.deploy(aTkn.address, aTkn.decimals())

    CTokenMockFactory = await ethers.getContractFactory('CTokenMock')
    cTkn = <CTokenMock>await CTokenMockFactory.deploy('CToken', 'CTKN1', token1.address)
    CTokenAssetFactory = await ethers.getContractFactory('CTokenCollateralP0')
    assetCToken = <CTokenCollateralP0>await CTokenAssetFactory.deploy(cTkn.address, cTkn.decimals())

    // Quantities
    quantity0 = qtyHalf
    quantity1 = qtyHalf
    quantity2 = qtyThird
    quantity3 = qtyDouble

    collateral = [collateral0.address, collateral1.address, collateral2.address, collateral3.address]
    quantities = [quantity0, quantity1, quantity2, quantity3]

    VaultFactory = await ethers.getContractFactory('VaultP0')
    vault = <VaultP0>await VaultFactory.deploy(collateral, quantities, [])

    // Setup Main
    await vault.connect(owner).setMain(main.address)

    // Get Default Monitor
    DefaultMonitorFactory = await ethers.getContractFactory('DefaultMonitorP0')
    defaultMonitor = <DefaultMonitorP0>await DefaultMonitorFactory.deploy(main.address)

    compoundOracle = <CompoundOracleMockP0>(
      await ethers.getContractAt('CompoundOracleMockP0', await main.compoundOracle())
    )
    aaveOracle = <AaveOracleMockP0>await ethers.getContractAt('AaveOracleMockP0', await main.aaveOracle())

    // Set Default Oracle Prices
    await compoundOracle.setPrice('TKN0', bn('1e6'))
    await compoundOracle.setPrice('TKN1', bn('1e6'))
    await compoundOracle.setPrice('TKN2', bn('1e6'))
    await compoundOracle.setPrice('TKN3', bn('1e6'))
    await compoundOracle.setPrice('ETH', bn('4000e6'))
    await compoundOracle.setPrice('COMP', bn('1e6'))

    await aaveOracle.setPrice(token0.address, bn('2.5e14'))
    await aaveOracle.setPrice(token1.address, bn('2.5e14'))
    await aaveOracle.setPrice(token2.address, bn('2.5e14'))
    await aaveOracle.setPrice(token3.address, bn('2.5e14'))
    await aaveOracle.setPrice(weth.address, bn('1e18'))
    await aaveOracle.setPrice(aaveToken.address, bn('1e18'))
    await aaveOracle.setPrice(compToken.address, bn('1e18'))
    await aaveOracle.setPrice(rsr.address, bn('1e18'))
  })

  describe('Deployment', () => {
    it('Should setup Default Monitor correctly', async () => {
      expect(await defaultMonitor.main()).to.equal(main.address)
    })
  })

  describe('Soft Default', function () {
    it('Should not detect soft default in normal situations', async function () {
      // Detect Soft default
      defaulting = await defaultMonitor.checkForSoftDefault(vault.address, collateral)
      expect(defaulting).to.be.empty
    })

    it('Should not detect soft default if within default threshold', async function () {
      // Change fiat coin price within 5%
      await aaveOracle.setPrice(token0.address, bn('2.4e14'))

      // Detect Soft default
      defaulting = await defaultMonitor.checkForSoftDefault(vault.address, collateral)
      expect(defaulting).to.be.empty
    })

    it('Should detect soft default for single token', async function () {
      // Change fiatcoin price - Reduce price significantly in terms of ETH
      await aaveOracle.setPrice(token0.address, bn('1.5e14'))

      // Detect Soft Default
      defaulting = await defaultMonitor.checkForSoftDefault(vault.address, collateral)
      expect(defaulting).to.eql([collateral0.address])

      // Increase back significantly, this should not trigger default
      await aaveOracle.setPrice(token0.address, bn('4e14'))

      // Detect Soft Default
      defaulting = await defaultMonitor.checkForSoftDefault(vault.address, collateral)
      expect(defaulting).to.be.empty
    })

    it('Should detect soft default for multiple tokens', async function () {
      // Change fiatcoin price for two of the tokens - Reduce price significantly in terms of ETH
      await aaveOracle.setPrice(token2.address, bn('1e14'))
      await aaveOracle.setPrice(token3.address, bn('1.5e14'))

      // Detect Soft Default
      defaulting = await defaultMonitor.checkForSoftDefault(vault.address, collateral)
      expect(defaulting).to.eql([collateral2.address, collateral3.address])
    })

    it('Should detect soft default for basket with even number of tokens', async function () {
      // Change fiatcoin price for two of the tokens - Reduce price significantly in terms of ETH
      const newVault: VaultP0 = <VaultP0>(
        await VaultFactory.deploy(
          [collateral[0], collateral[1], collateral[2]],
          [quantities[0], quantities[1], quantities[2]],
          []
        )
      )
      await main.connect(owner).setVault(newVault.address)

      await aaveOracle.setPrice(token0.address, bn('1e14'))

      // Detect Soft Default
      defaulting = await defaultMonitor.checkForSoftDefault(newVault.address, [
        collateral[0],
        collateral[1],
        collateral[2],
      ])
      expect(defaulting).to.eql([collateral0.address])
    })
  })

  describe('Hard Default', () => {
    it('Should not detect hard default in normal situations with fiat tokens', async function () {
      // Detect Hard default - Needs to be called from Main
      defaulting = await main.callStatic.checkForHardDefault(vault.address)
      expect(defaulting).to.be.empty
    })

    it('Should never detect hard default for fiat tokens', async function () {
      // Change value for fiat token but this does not impact rateUSD
      await aaveOracle.setPrice(token0.address, bn('1e14'))

      // Detect Hard default
      defaulting = await main.callStatic.checkForHardDefault(vault.address)
      expect(defaulting).to.be.empty
    })

    context('With ATokens and CTokens', async function () {
      let newVault: VaultP0

      beforeEach(async function () {
        // Set new Vault with Atokens and CTokens
        const qtyHalfCToken: BigNumber = bn('1e8').div(2)

        newVault = <VaultP0>(
          await VaultFactory.deploy([assetAToken.address, assetCToken.address], [qtyHalf, qtyHalfCToken], [])
        )

        // Set new vault
        await main.connect(owner).setVault(newVault.address)

        // Call to populate last rates
        await main.checkForHardDefault(newVault.address)
      })

      it('Should not detect hard default in normal situations', async function () {
        // Detect Hard default - Needs to be called from Main
        defaulting = await main.callStatic.checkForHardDefault(newVault.address)
        expect(defaulting).to.be.empty
      })

      it('Should detect hard default if rate decreases for single token', async function () {
        // Change redemption rate for AToken
        await aTkn.setExchangeRate(fp('0.98'))

        // Detect Hard default
        defaulting = await main.callStatic.checkForHardDefault(newVault.address)
        expect(defaulting).to.eql([assetAToken.address])
      })

      it('Should detect hard default if rate decreases for multiple tokens', async function () {
        // Change redemption rate for AToken
        await aTkn.setExchangeRate(fp('0.98'))

        // Change redemption rate for CToken  - Original rate is 2e26
        await cTkn.setExchangeRate(fp('1.5'))

        // Call a few times to make sure default is still detected
        await main.checkForHardDefault(newVault.address)
        await main.checkForHardDefault(newVault.address)

        // Detect Hard default
        defaulting = await main.callStatic.checkForHardDefault(newVault.address)
        expect(defaulting).to.eql([assetAToken.address, assetCToken.address])
      })
    })
  })

  describe('Get Next Vault', () => {
    let backupVault1: VaultP0
    let backupVault2: VaultP0
    let backupVault3: VaultP0
    let backupVault4: VaultP0

    beforeEach(async function () {
      // Deploy backup vaults
      backupVault1 = <VaultP0>await VaultFactory.deploy([collateral[0]], [quantities[0]], [])
      backupVault2 = <VaultP0>(
        await VaultFactory.deploy([collateral[0], collateral[1]], [quantities[0], quantities[1]], [])
      )
      backupVault3 = <VaultP0>(
        await VaultFactory.deploy(
          [collateral[0], collateral[1], collateral[2]],
          [quantities[0], quantities[1], quantities[2]],
          []
        )
      )
      backupVault4 = <VaultP0>(
        await VaultFactory.deploy([collateral[1], collateral[2]], [quantities[1], quantities[2]], [])
      )

      await vault
        .connect(owner)
        .setBackups([backupVault1.address, backupVault2.address, backupVault3.address, backupVault4.address])
    })

    it('Should return zero address if there is no valid backup vault', async function () {
      // Get next vault with different token
      const nextVaultAddr: string = await defaultMonitor.callStatic.getNextVault(
        vault.address,
        [assetAToken.address],
        collateral
      )
      expect(nextVaultAddr).to.equal(ZERO_ADDRESS)
    })

    it('Should return a valid vault based on accepted collateral', async function () {
      // Get the only valid vault that contains only approved collateral
      let nextVaultAddr: string = await defaultMonitor.callStatic.getNextVault(
        vault.address,
        [collateral[0]],
        collateral
      )
      expect(nextVaultAddr).to.equal(backupVault1.address)

      // Another example
      nextVaultAddr = await defaultMonitor.callStatic.getNextVault(
        vault.address,
        [collateral[1], collateral[2]],
        collateral
      )
      expect(nextVaultAddr).to.equal(backupVault4.address)
    })

    it('Should return the one with highest rate', async function () {
      // Return the vault with highest rate (all 3 candidates are valid)
      let nextVaultAddr: string = await defaultMonitor.callStatic.getNextVault(
        vault.address,
        [collateral[0], collateral[1], collateral[2]],
        collateral
      )
      expect(nextVaultAddr).to.equal(backupVault3.address)

      // Another example, backupVault2 now has the higer rate among the valid ones
      nextVaultAddr = await defaultMonitor.callStatic.getNextVault(
        vault.address,
        [collateral[0], collateral[1]],
        collateral
      )
      expect(nextVaultAddr).to.equal(backupVault2.address)
    })
  })
})
