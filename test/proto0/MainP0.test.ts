import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory } from 'ethers'
import { bn } from '../../common/numbers'
import { expectInReceipt } from '../../common/events'
import { BN_SCALE_FACTOR } from '../../common/constants'

import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { AssetP0 } from '../../typechain/AssetP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { MainP0 } from '../../typechain/MainP0'
import { VaultP0 } from '../../typechain/VaultP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { IManagerConfig, IParamsAssets } from './DeployerP0.test'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { AssetManagerP0 } from '../../typechain/AssetManagerP0'
import { DefaultMonitorP0 } from '../../typechain/DefaultMonitorP0'

enum State {
  CALM = 0,
  DOUBT = 1,
  TRADING = 2,
  PRECAUTIONARY = 3,
}

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let DeployerFactory: ContractFactory
  let deployer: DeployerP0

  // Vault and Assets
  let ERC20: ContractFactory
  let tkn0: ERC20Mock
  let tkn1: ERC20Mock
  let tkn2: ERC20Mock
  let tkn3: ERC20Mock
  let VaultFactory: ContractFactory
  let vault: VaultP0
  let AssetFactory: ContractFactory
  let asset0: AssetP0
  let asset1: AssetP0
  let asset2: AssetP0
  let asset3: AssetP0
  let quantity0: BigNumber
  let quantity1: BigNumber
  let quantity2: BigNumber
  let quantity3: BigNumber
  let quantities: BigNumber[]
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber
  let assets: string[]

  // RSR
  let RSRAssetFactory: ContractFactory
  let rsr: ERC20Mock
  let rsrAsset: RSRAssetP0

  // AAVE and Compound
  let COMPAssetFactory: ContractFactory
  let ComptrollerMockFactory: ContractFactory
  let CompoundOracleMockFactory: ContractFactory
  let compToken: ERC20Mock
  let compAsset: COMPAssetP0
  let compoundMock: ComptrollerMockP0
  let compoundOracle: CompoundOracleMockP0
  let AAVEAssetFactory: ContractFactory
  let AaveLendingPoolMockFactory: ContractFactory
  let AaveAddrProviderFactory: ContractFactory
  let AaveOracleMockFactory: ContractFactory
  let weth: ERC20Mock
  let aaveToken: ERC20Mock
  let aaveAsset: AAVEAssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveAddrProvider: AaveLendingAddrProviderMockP0
  let aaveOracle: AaveOracleMockP0

  // Config values
  let config: IManagerConfig
  let paramsAssets: IParamsAssets
  let rewardStart: BigNumber
  const rewardPeriod: BigNumber = bn(604800) // 1 week
  const auctionPeriod: BigNumber = bn(1800) // 30 minutes
  const stRSRWithdrawalDelay: BigNumber = bn(1209600) // 2 weeks
  const defaultDelay: BigNumber = bn(86400) // 24 hs
  const maxTradeSlippage: BigNumber = bn(5e16) // 5%
  const auctionClearingTolerance: BigNumber = bn(5e16) // 5%
  const maxAuctionSize: BigNumber = bn(1e16) // 1%
  const minRecapitalizationAuctionSize: BigNumber = bn(1e15) // 0.1%
  const minRevenueAuctionSize: BigNumber = bn(1e14) // 0.01%
  const migrationChunk: BigNumber = bn(2e17) // 20%
  const issuanceRate: BigNumber = bn(25e13) // 0.025% per block or ~0.1% per minute
  const defaultThreshold: BigNumber = bn(5e16) // 5% deviation
  const f: BigNumber = bn(6e17) // 60% to stakers

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let assetManager: AssetManagerP0
  let defaultMonitor: DefaultMonitorP0

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Create Deployer
    DeployerFactory = await ethers.getContractFactory('DeployerP0')
    deployer = <DeployerP0>await DeployerFactory.connect(owner).deploy()

    // Deploy RSR and asset
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')
    RSRAssetFactory = await ethers.getContractFactory('RSRAssetP0')
    rsrAsset = <RSRAssetP0>await RSRAssetFactory.deploy(rsr.address)

    // Deploy COMP token and Asset
    compToken = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')
    COMPAssetFactory = await ethers.getContractFactory('COMPAssetP0')
    compAsset = <COMPAssetP0>await COMPAssetFactory.deploy(compToken.address)

    // Deploy AAVE token and Asset
    aaveToken = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')
    AAVEAssetFactory = await ethers.getContractFactory('AAVEAssetP0')
    aaveAsset = <AAVEAssetP0>await AAVEAssetFactory.deploy(aaveToken.address)

    // Deploy Comp and Aave Oracle Mocks
    CompoundOracleMockFactory = await ethers.getContractFactory('CompoundOracleMockP0')
    compoundOracle = <CompoundOracleMockP0>await CompoundOracleMockFactory.deploy()

    ComptrollerMockFactory = await ethers.getContractFactory('ComptrollerMockP0')
    compoundMock = <ComptrollerMockP0>await ComptrollerMockFactory.deploy(compoundOracle.address)

    AaveOracleMockFactory = await ethers.getContractFactory('AaveOracleMockP0')
    weth = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')
    aaveOracle = <AaveOracleMockP0>await AaveOracleMockFactory.deploy(weth.address)

    AaveAddrProviderFactory = await ethers.getContractFactory('AaveLendingAddrProviderMockP0')
    aaveAddrProvider = <AaveLendingAddrProviderMockP0>await AaveAddrProviderFactory.deploy(aaveOracle.address)

    AaveLendingPoolMockFactory = await ethers.getContractFactory('AaveLendingPoolMockP0')
    aaveMock = <AaveLendingPoolMockP0>await AaveLendingPoolMockFactory.deploy(aaveAddrProvider.address)

    // Deploy Main Vault
    tkn0 = <ERC20Mock>await ERC20.deploy('Token 0', 'TKN0')
    tkn1 = <ERC20Mock>await ERC20.deploy('Token 1', 'TKN1')
    tkn2 = <ERC20Mock>await ERC20.deploy('Token 2', 'TKN2')
    tkn3 = <ERC20Mock>await ERC20.deploy('Token 3', 'TKN2')

    // Set initial amounts and set quantities
    initialBal = bn(100000e18)
    qtyHalf = bn(1e18).div(2)
    qtyThird = bn(1e18).div(3)
    qtyDouble = bn(1e18).mul(2)

    // Mint tokens
    await tkn0.connect(owner).mint(addr1.address, initialBal)
    await tkn1.connect(owner).mint(addr1.address, initialBal)
    await tkn2.connect(owner).mint(addr1.address, initialBal)
    await tkn3.connect(owner).mint(addr1.address, initialBal)

    await tkn0.connect(owner).mint(addr2.address, initialBal)
    await tkn1.connect(owner).mint(addr2.address, initialBal)
    await tkn2.connect(owner).mint(addr2.address, initialBal)
    await tkn3.connect(owner).mint(addr2.address, initialBal)

    // Set Collateral Assets and Quantities
    AssetFactory = await ethers.getContractFactory('AssetP0')
    asset0 = <AssetP0>await AssetFactory.deploy(tkn0.address, tkn0.decimals())
    asset1 = <AssetP0>await AssetFactory.deploy(tkn1.address, tkn1.decimals())
    asset2 = <AssetP0>await AssetFactory.deploy(tkn2.address, tkn2.decimals())
    asset3 = <AssetP0>await AssetFactory.deploy(tkn3.address, tkn3.decimals())

    quantity0 = qtyHalf
    quantity1 = qtyHalf
    quantity2 = qtyThird
    quantity3 = qtyDouble

    assets = [asset0.address, asset1.address, asset2.address, asset3.address]
    quantities = [quantity0, quantity1, quantity2, quantity3]

    VaultFactory = await ethers.getContractFactory('VaultP0')
    vault = <VaultP0>await VaultFactory.deploy(assets, quantities, [])

    paramsAssets = {
      rsrAsset: rsrAsset.address,
      compAsset: compAsset.address,
      aaveAsset: aaveAsset.address,
    }

    // Setup Config
    rewardStart = bn(await getLatestBlockTimestamp())
    config = {
      rewardStart: rewardStart,
      rewardPeriod: rewardPeriod,
      auctionPeriod: auctionPeriod,
      stRSRWithdrawalDelay: stRSRWithdrawalDelay,
      defaultDelay: defaultDelay,
      auctionClearingTolerance: auctionClearingTolerance,
      maxTradeSlippage: maxTradeSlippage,
      maxAuctionSize: maxAuctionSize,
      minRecapitalizationAuctionSize: minRecapitalizationAuctionSize,
      minRevenueAuctionSize: minRevenueAuctionSize,
      migrationChunk: migrationChunk,
      issuanceRate: issuanceRate,
      defaultThreshold: defaultThreshold,
      f: f,
    }

    // Deploy actual contracts
    const receipt = await (
      await deployer.deploy(
        'RToken',
        'RTKN',
        owner.address,
        vault.address,
        rsr.address,
        config,
        compoundMock.address,
        aaveMock.address,
        paramsAssets,
        assets
      )
    ).wait()

    const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main

    // Get Components
    main = <MainP0>await ethers.getContractAt('MainP0', mainAddr)
    rToken = <RTokenP0>await ethers.getContractAt('RTokenP0', await main.rToken())
    furnace = <FurnaceP0>await ethers.getContractAt('FurnaceP0', await main.furnace())
    stRSR = <StRSRP0>await ethers.getContractAt('StRSRP0', await main.stRSR())
    assetManager = <AssetManagerP0>await ethers.getContractAt('AssetManagerP0', await main.manager())
    defaultMonitor = <DefaultMonitorP0>await ethers.getContractAt('DefaultMonitorP0', await main.monitor())

    // Setup Main
    await vault.connect(owner).setMain(main.address)

    // Set Oracle prices
    await compoundOracle.setPrice('TKN0', bn(1e18))
    await compoundOracle.setPrice('TKN1', bn(1e18))
    await compoundOracle.setPrice('TKN2', bn(1e18))
    await compoundOracle.setPrice('TKN3', bn(1e18))
    await compoundOracle.setPrice('ETH', bn(1e18))
    await compoundOracle.setPrice('COMP', bn(1e18))

    await aaveOracle.setPrice(tkn0.address, bn(1e18))
    await aaveOracle.setPrice(tkn1.address, bn(1e18))
    await aaveOracle.setPrice(tkn2.address, bn(1e18))
    await aaveOracle.setPrice(tkn3.address, bn(1e18))
    await aaveOracle.setPrice(weth.address, bn(1e18))
    await aaveOracle.setPrice(aaveToken.address, bn(1e18))
  })

  describe('Deployment', () => {
    it('Should setup Main correctly', async () => {
      expect(await main.rsr()).to.equal(rsr.address)
      expect(await main.manager()).to.equal(assetManager.address)
      expect(await assetManager.vault()).to.equal(vault.address)
      expect(await main.comptroller()).to.equal(compoundMock.address)
      expect(await main.config()).to.eql(Object.values(config))
      const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.state()).to.equal(State.CALM)
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.pauser()).to.equal(owner.address)
    })
  })

  describe('Pause/Unpause', () => {
    it('Should Pause/Unpause for Pauser and Owner', async () => {
      // Set different Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Check initial status
      expect(await main.pauser()).to.equal(addr1.address)
      expect(await main.paused()).to.equal(false)

      // Pause with Pauser
      await main.connect(addr1).pause()

      // Check if Paused
      expect(await main.paused()).to.equal(true)

      // Unpause with Pauser
      await main.connect(addr1).unpause()

      expect(await main.paused()).to.equal(false)

      // Owner should still be able to Pause
      await main.connect(owner).pause()

      // Check if Paused
      expect(await main.paused()).to.equal(true)

      // Unpause with Owner
      await main.connect(owner).unpause()

      expect(await main.paused()).to.equal(false)
    })

    it('Should not allow to Pause/Unpause if not Pauser or Owner', async () => {
      // Set different Pauser
      await main.connect(owner).setPauser(addr1.address)

      await expect(main.connect(other).pause()).to.be.revertedWith('only pauser or owner')

      // Check no changes
      expect(await main.paused()).to.equal(false)

      await expect(main.connect(other).unpause()).to.be.revertedWith('only pauser or owner')

      // Check no changes
      expect(await main.paused()).to.equal(false)
    })

    it('Should allow to set Pauser if Owner or Pauser', async () => {
      // Set Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Check Pauser updated
      expect(await main.pauser()).to.equal(addr1.address)

      // Now update it with Pauser
      await main.connect(addr1).setPauser(owner.address)

      // Check Pauser updated
      expect(await main.pauser()).to.equal(owner.address)
    })

    it('Should not allow to set Pauser if not Owner', async () => {
      // Set Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Set Pauser
      await expect(main.connect(other).setPauser(other.address)).to.be.revertedWith('only pauser or owner')

      // Check Pauser not updated
      expect(await main.pauser()).to.equal(addr1.address)
    })
  })

  describe('Configuration/State', () => {
    it('Should return nextRewards correctly', async () => {
      // Check next immediate reward
      expect(await main.nextRewards()).to.equal(rewardStart.add(rewardPeriod))

      // Advance time to get next reward
      await advanceTime(rewardPeriod.toString())

      // Check next reward date
      expect(await main.nextRewards()).to.equal(rewardStart.add(rewardPeriod.mul(2)))

      // Advance time to get next reward
      await advanceTime(rewardPeriod.mul(2).toString())

      // Check next reward date
      expect(await main.nextRewards()).to.equal(rewardStart.add(rewardPeriod.mul(4)))
    })

    it('Should quote collateral correctly', async () => {
      expect(await main.quote(bn(1e18))).to.eql([qtyHalf, qtyHalf, qtyThird, qtyDouble])
      expect(await main.quote(bn(2e18))).to.eql([qtyHalf.mul(2), qtyHalf.mul(2), qtyThird.mul(2), qtyDouble.mul(2)])
    })

    it('Should return backing tokens', async () => {
      expect(await main.backingTokens()).to.eql([tkn0.address, tkn1.address, tkn2.address, tkn3.address])
    })
  })

  describe('Issuance and Slow Minting', function () {
    it('Should not issue RTokens if paused', async function () {
      const issueAmount: BigNumber = bn(10e18)

      // Pause Main
      await main.connect(owner).pause()

      // Try to issue
      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith('paused')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
      //expect(await main.issuances(0)).to.be.empty
    })

    it('Should not issue RTokens if amount is zero', async function () {
      const zero: BigNumber = bn(0)

      // Try to issue
      await expect(main.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn(10e18)

      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = bn(10000000000e18)

      await expect(main.connect(addr1).issue(issueAmount)).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await vault.basketUnits(main.address)).to.equal(0)
    })

    it('Should issue RTokens with single basket token', async function () {
      const issueAmount: BigNumber = bn(10e18)
      const qty: BigNumber = bn(1e18)
      const newVault: VaultP0 = <VaultP0>await VaultFactory.deploy([assets[0]], [qty], [])

      // Update Vault
      await assetManager.connect(owner).switchVault(newVault.address)

      // Provide approvals
      await tkn0.connect(addr1).approve(main.address, initialBal)

      // check balances before
      expect(await tkn0.balanceOf(newVault.address)).to.equal(0)
      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await newVault.basketUnits(main.address)).to.equal(0)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await tkn0.balanceOf(newVault.address)).to.equal(issueAmount)
      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount))
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await newVault.basketUnits(main.address)).to.equal(issueAmount)

      // Check if minting was registered
      const currentBlockNumber = await ethers.provider.getBlockNumber()
      const [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(0)
      expect(sm_vault).to.equal(newVault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_at).to.equal(currentBlockNumber + 1)
      expect(sm_proc).to.equal(false)
    })

    it('Should issue RTokens correctly for more complex basket multiple users', async function () {
      const issueAmount: BigNumber = bn(10e18)
      const expectedTkn0: BigNumber = issueAmount.mul(qtyHalf).div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount.mul(qtyHalf).div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount.mul(qtyThird).div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount.mul(qtyDouble).div(BN_SCALE_FACTOR)

      // Provide approvals
      await tkn0.connect(addr1).approve(main.address, initialBal)
      await tkn1.connect(addr1).approve(main.address, initialBal)
      await tkn2.connect(addr1).approve(main.address, initialBal)
      await tkn3.connect(addr1).approve(main.address, initialBal)

      // check balances before
      expect(await tkn0.balanceOf(vault.address)).to.equal(0)
      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await tkn1.balanceOf(vault.address)).to.equal(0)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await tkn2.balanceOf(vault.address)).to.equal(0)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await tkn3.balanceOf(vault.address)).to.equal(0)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await vault.basketUnits(main.address)).to.equal(0)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await tkn0.balanceOf(vault.address)).to.equal(expectedTkn0)
      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      expect(await tkn1.balanceOf(vault.address)).to.equal(expectedTkn1)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      expect(await tkn2.balanceOf(vault.address)).to.equal(expectedTkn2)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      expect(await tkn3.balanceOf(vault.address)).to.equal(expectedTkn3)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Check if minting was registered
      let currentBlockNumber = await ethers.provider.getBlockNumber()
      let [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(0)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_at).to.equal(currentBlockNumber + 1)
      expect(sm_proc).to.equal(false)

      // Issue new RTokens with different user
      // This will also process the previous minting and send funds to the minter
      // Provide approvals
      await tkn0.connect(addr2).approve(main.address, initialBal)
      await tkn1.connect(addr2).approve(main.address, initialBal)
      await tkn2.connect(addr2).approve(main.address, initialBal)
      await tkn3.connect(addr2).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr2).issue(issueAmount)

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Check Balances after
      expect(await tkn0.balanceOf(vault.address)).to.equal(expectedTkn0.mul(2))
      expect(await tkn1.balanceOf(vault.address)).to.equal(expectedTkn1.mul(2))
      expect(await tkn2.balanceOf(vault.address)).to.equal(expectedTkn2.mul(2))
      expect(await tkn3.balanceOf(vault.address)).to.equal(expectedTkn3.mul(2))

      // Check new issuances was processed
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr2.address)).to.equal(0)
      ;[sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(1)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr2.address)
      //expect(sm_at).to.equal()
      expect(sm_proc).to.equal(false)
    })

    it('Should process issuances in multiple attempts (2 blocks)', async function () {
      const issueAmount: BigNumber = bn(50000e18)

      const expectedTkn0: BigNumber = issueAmount.mul(qtyHalf).div(BN_SCALE_FACTOR)
      const expectedTkn1: BigNumber = issueAmount.mul(qtyHalf).div(BN_SCALE_FACTOR)
      const expectedTkn2: BigNumber = issueAmount.mul(qtyThird).div(BN_SCALE_FACTOR)
      const expectedTkn3: BigNumber = issueAmount.mul(qtyDouble).div(BN_SCALE_FACTOR)

      // Provide approvals
      await tkn0.connect(addr1).approve(main.address, initialBal)
      await tkn1.connect(addr1).approve(main.address, initialBal)
      await tkn2.connect(addr1).approve(main.address, initialBal)
      await tkn3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await tkn0.balanceOf(vault.address)).to.equal(expectedTkn0)
      expect(await tkn0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      expect(await tkn1.balanceOf(vault.address)).to.equal(expectedTkn1)
      expect(await tkn1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      expect(await tkn2.balanceOf(vault.address)).to.equal(expectedTkn2)
      expect(await tkn2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      expect(await tkn3.balanceOf(vault.address)).to.equal(expectedTkn3)
      expect(await tkn3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await vault.basketUnits(main.address)).to.equal(issueAmount)

      // Check if minting was registered
      let currentBlockNumber = await ethers.provider.getBlockNumber()
      let [sm_vault, sm_amt, sm_bu, sm_minter, sm_at, sm_proc] = await main.issuances(0)
      expect(sm_vault).to.equal(vault.address)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_bu).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      // Using minimum issuance of 10,000 per block = 5 blockss
      expect(sm_at).to.equal(currentBlockNumber + 5)
      expect(sm_proc).to.equal(false)

      // Process slow issuances
      await main.poke()

      // Check previous minting was not processed
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Process slow mintings 4 times
      await main.poke()
      await main.poke()
      await main.poke()
      await main.poke()

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await main.issuances(0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await vault.basketUnits(main.address)).to.equal(0)
      expect(await vault.basketUnits(assetManager.address)).to.equal(issueAmount)
    })
  })

  describe('Redeem', () => {})
  describe('Notice Default', () => {})
})
