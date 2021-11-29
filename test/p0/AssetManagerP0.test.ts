import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { BN_SCALE_FACTOR, MAX_UINT256 } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AssetManagerP0 } from '../../typechain/AssetManagerP0'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DefaultMonitorP0 } from '../../typechain/DefaultMonitorP0'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { MarketMock } from '../../typechain/MarketMock'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { VaultP0 } from '../../typechain/VaultP0'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { defaultFixture, Fate, IManagerConfig, State } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

export interface IAuctionInfo {
  sell: string
  buy: string
  sellAmount: BigNumber
  minBuyAmount: BigNumber
  startTime: number
  endTime: number
  clearingSellAmount: BigNumber
  clearingBuyAmount: BigNumber
  fate: Fate
  isOpen: boolean
}

describe('AssetManagerP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Vault and Assets
  let VaultFactory: ContractFactory
  let vault: VaultP0
  let collateral: string[]

  // AssetManager
  let AssetManagerFactory: ContractFactory

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: RSRAssetP0

  // AAVE and Compound
  let compToken: ERC20Mock
  let compAsset: COMPAssetP0
  let compoundMock: ComptrollerMockP0
  let compoundOracle: CompoundOracleMockP0
  let aaveToken: ERC20Mock
  let aaveAsset: AAVEAssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveOracle: AaveOracleMockP0

  // Tokens and Assets
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber

  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: ERC20Mock
  let token3: ERC20Mock
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: CollateralP0
  let collateral3: CollateralP0
  let ATokenMockFactory: ContractFactory
  let ATokenAssetFactory: ContractFactory
  let aToken: StaticATokenMock
  let assetAToken: ATokenCollateralP0
  let CTokenMockFactory: ContractFactory
  let CTokenAssetFactory: ContractFactory
  let cToken: CTokenMock
  let assetCToken: CTokenCollateralP0

  // Config values
  let config: IManagerConfig

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let assetManager: AssetManagerP0
  let defaultMonitor: DefaultMonitorP0
  let trading: MarketMock

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const expectAuctionInfo = async (index: number, auctionInfo: Partial<IAuctionInfo>) => {
    const {
      sell,
      buy,
      sellAmount,
      minBuyAmount,
      startTime,
      endTime,
      clearingSellAmount,
      clearingBuyAmount,
      fate,
      isOpen,
    } = await assetManager.auctions(index)
    expect(sell).to.equal(auctionInfo.sell)
    expect(buy).to.equal(auctionInfo.buy)
    expect(sellAmount).to.equal(auctionInfo.sellAmount)
    expect(minBuyAmount).to.equal(auctionInfo.minBuyAmount)
    expect(startTime).to.equal(auctionInfo.startTime)
    expect(endTime).to.equal(auctionInfo.endTime)
    expect(clearingSellAmount).to.equal(auctionInfo.clearingSellAmount)
    expect(clearingBuyAmount).to.equal(auctionInfo.clearingBuyAmount)
    expect(fate).to.equal(auctionInfo.fate)
    expect(isOpen).to.equal(auctionInfo.isOpen)
  }

  const expectAuctionOpen = async (index: number, value: boolean) => {
    const { isOpen } = await assetManager.auctions(index)
    expect(isOpen).to.equal(value)
  }

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundOracle,
      aaveOracle,
      compoundMock,
      aaveMock,
      token0,
      token1,
      token2,
      token3,
      collateral0,
      collateral1,
      collateral2,
      collateral3,
      collateral,
      vault,
      config,
      deployer,
      main,
      rToken,
      furnace,
      stRSR,
      assetManager,
      defaultMonitor,
      trading,
    } = await loadFixture(defaultFixture))

    // Mint initial balances
    initialBal = bn('100000e18')
    qtyHalf = bn('1e18').div(2)
    qtyThird = bn('1e18').div(3)
    qtyDouble = bn('1e18').mul(2)
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    // ATokens and CTokens
    ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
    aToken = <StaticATokenMock>await ATokenMockFactory.deploy('AToken', 'ATKN0', token0.address)
    await aToken.setAaveToken(aaveToken.address)
    ATokenAssetFactory = await ethers.getContractFactory('ATokenCollateralP0')
    assetAToken = <ATokenCollateralP0>await ATokenAssetFactory.deploy(aToken.address, aToken.decimals())

    CTokenMockFactory = await ethers.getContractFactory('CTokenMock')
    cToken = <CTokenMock>await CTokenMockFactory.deploy('CToken', 'CTKN1', token1.address)
    CTokenAssetFactory = await ethers.getContractFactory('CTokenCollateralP0')
    assetCToken = <CTokenCollateralP0>await CTokenAssetFactory.deploy(cToken.address, cToken.decimals())

    // Mint ATokens and CTokens
    await aToken.connect(owner).mint(addr1.address, initialBal)
    await cToken.connect(owner).mint(addr1.address, initialBal)

    // Set Vault Factory (for creating additional vaults in tests)
    VaultFactory = await ethers.getContractFactory('VaultP0')

    // Setup Main
    await vault.connect(owner).setMain(main.address)
  })

  // Note: Issuance, Redemption, and Vault management are tested as part of MainP0

  describe('Deployment', () => {
    it('Should setup Asset Manager correctly', async () => {
      expect(await assetManager.main()).to.equal(main.address)
      expect(await assetManager.vault()).to.equal(vault.address)
      expect(await assetManager.owner()).to.equal(owner.address)
      expect(await assetManager.approvedFiatcoins()).to.eql(collateral)
      expect(await assetManager.baseFactor()).to.equal(fp('1'))
      expect(await rsr.allowance(assetManager.address, stRSR.address)).to.equal(MAX_UINT256)
      expect(await main.manager()).to.equal(assetManager.address)
    })

    it('Should revert if Vault has unapproved collateral', async () => {
      // Create a new asset manager with unapproved collateral in the vault
      AssetManagerFactory = await ethers.getContractFactory('AssetManagerP0')
      await expect(
        AssetManagerFactory.deploy(main.address, vault.address, trading.address, owner.address, [collateral[0]])
      ).to.be.revertedWith('UnapprovedCollateral()')
    })
  })

  describe('Base Factor', () => {
    it('Should start with Base Factor = 1', async () => {
      expect(await assetManager.baseFactor()).to.equal(fp('1'))
      expect(await assetManager.toBUs(bn('1e18'))).to.equal(bn('1e18'))
      expect(await assetManager.fromBUs(bn('1e18'))).to.equal(bn('1e18'))
    })

    context('With issued RTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await token0.connect(addr1).approve(main.address, initialBal)
        await token1.connect(addr1).approve(main.address, initialBal)
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process the issuance
        await main.poke()
      })

      it('Should update Base Factor based on Melting Factor', async () => {
        expect(await assetManager.baseFactor()).to.equal(fp('1'))
        expect(await assetManager.toBUs(bn('1e18'))).to.equal(bn('1e18'))
        expect(await assetManager.fromBUs(bn('1e18'))).to.equal(bn('1e18'))

        // Melt some Rtokens
        let hndAmt: BigNumber = bn('1e18')
        await rToken.connect(addr1).approve(furnace.address, hndAmt)
        await furnace.connect(addr1).burnOverPeriod(hndAmt, 0)

        // Call poke to burn tokens
        await main.poke()

        expect(await assetManager.baseFactor()).to.equal(fp('100').div(99))
        expect(await assetManager.toBUs(bn('1e18'))).to.equal(bn('100e18').div(99))
        expect(await assetManager.fromBUs(bn('1e18'))).to.equal(bn('0.99e18'))

        // Melt some more Rtokens
        hndAmt = bn('49e18')
        await rToken.connect(addr1).approve(furnace.address, hndAmt)
        await furnace.connect(addr1).burnOverPeriod(hndAmt, 0)

        // Call poke to burn tokens
        await main.poke()

        expect(await assetManager.baseFactor()).to.equal(fp('100').div(50))
        expect(await assetManager.toBUs(bn('1e18'))).to.equal(bn('100e18').div(50))
        expect(await assetManager.fromBUs(bn('1e18'))).to.equal(bn('0.5e18'))
      })
    })

    context('With ATokens and CTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Setup new vault with ATokens and CTokens
        const qtyHalfCToken: BigNumber = bn('1e8').div(2)

        let newVault: VaultP0 = <VaultP0>(
          await VaultFactory.deploy([assetAToken.address, assetCToken.address], [qtyHalf, qtyHalfCToken], [])
        )
        // Setup Main
        await newVault.connect(owner).setMain(main.address)

        // Switch Vault
        await assetManager.connect(owner).switchVault(newVault.address)

        // Provide approvals
        await aToken.connect(addr1).approve(main.address, initialBal)
        await cToken.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process the issuance
        await main.poke()
      })

      it('Should update Base Factor based on Basket Dilution Factor', async () => {
        expect(await assetManager.baseFactor()).to.equal(fp('1'))
        expect(await assetManager.toBUs(bn('1e18'))).to.equal(bn('1e18'))
        expect(await assetManager.fromBUs(bn('1e18'))).to.equal(bn('1e18'))

        // Increase rate for ATokens CToken to double - 100% increase so a 60% applies to base factor (based on f)
        await aToken.setExchangeRate(fp(2))
        await cToken.setExchangeRate(fp(2))

        await assetManager.baseFactor()

        // f = fp(0.6) = 40% increase in price of RToken -> (1 + 0.4) / 2 = 7/10
        let b = fp(1)
          .add(bn(2 - 1).mul(fp(1).sub(config.f)))
          .div(bn(2))
        expect(await assetManager.baseFactor()).to.equal(b)
        expect(await assetManager.toBUs(bn('1e18'))).to.equal(b)
        expect(await assetManager.fromBUs(bn('1e18'))).to.equal(fp('1e18').div(b))

        // Double again (300% increase)
        await aToken.setExchangeRate(fp(4))
        await cToken.setExchangeRate(fp(4))

        // f = fp(0.6) - 60% of 300% increase = 180% increase in price of RToken -> (1 + 1.8) / 4 = 7/10
        b = fp(1)
          .add(bn(4 - 1).mul(fp(1).sub(config.f)))
          .div(bn(4))
        expect(await assetManager.baseFactor()).to.equal(b)
        expect(await assetManager.toBUs(bn('1e18'))).to.equal(b)
        expect(await assetManager.fromBUs(bn('1e18'))).to.equal(fp('1e18').div(b))
      })
    })
  })

  describe('Revenues', () => {
    it('Should only be called by Main', async () => {
      await expect(assetManager.connect(other).collectRevenue()).to.be.revertedWith(
        'only main can mutate the asset manager'
      )
    })

    it('Should handle minting of new RTokens for rounding (in Melting)', async () => {
      // Issue some RTokens to user
      const issueAmount: BigNumber = bn('100e18')
      // Provide approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Call to process revenue
      await main.poke()

      // Melt some Rtokens to increase base factor -  No rounding required
      const hndAmt: BigNumber = bn('20e18')
      await rToken.connect(addr1).approve(furnace.address, hndAmt)
      await furnace.connect(addr1).burnOverPeriod(hndAmt, 0)

      // Advance time to get next reward
      await advanceTime(config.rewardPeriod.add(100).toString())

      // Call collect revenue
      await main.poke()

      // No RTokens Minted
      expect(await rToken.totalSupply()).to.equal(issueAmount.sub(hndAmt))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(hndAmt))
      expect(await rToken.balanceOf(assetManager.address)).to.equal(0)

      // Burn some more RTokens
      const hndAmt2: BigNumber = bn('10e18')
      await rToken.connect(addr1).approve(furnace.address, hndAmt2)
      await furnace.connect(addr1).burnOverPeriod(hndAmt2, 0)

      // Advance time to get next reward
      await advanceTime(config.rewardPeriod.add(100).toString())

      // Call collect revenue
      await main.poke()

      // Some RTokens were minted to handle rounding
      const bUnits: BigNumber = await vault.basketUnits(assetManager.address)

      expect(await rToken.totalSupply()).to.equal(fp(bUnits).div(await assetManager.baseFactor()))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(hndAmt).sub(hndAmt2))
      expect(await rToken.balanceOf(assetManager.address)).to.equal(
        fp(bUnits)
          .div(await assetManager.baseFactor())
          .sub(await rToken.balanceOf(addr1.address))
      )
    })

    // With ATokens and CTokens
    context('With ATokens and CTokens', async function () {
      let newVault: VaultP0
      let issueAmount: BigNumber
      let rewardAmountCOMP: BigNumber
      let rewardAmountAAVE: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Set vault with ATokens and CTokens
        const qtyHalfCToken: BigNumber = bn('1e8').div(2)
        newVault = <VaultP0>(
          await VaultFactory.deploy([assetAToken.address, assetCToken.address], [qtyHalf, qtyHalfCToken], [])
        )
        // Setup Main
        await newVault.connect(owner).setMain(main.address)

        // Switch Vault
        await assetManager.connect(owner).switchVault(newVault.address)

        // Provide approvals
        await aToken.connect(addr1).approve(main.address, initialBal)
        await cToken.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Process issuance
        await main.poke()

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should claim COMP and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // COMP Rewards
        await compoundMock.setRewards(newVault.address, rewardAmountCOMP)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountCOMP.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(assetManager, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(1, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken, Fate.Melt)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        expectAuctionInfo(0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(1, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Melt,
          isOpen: true,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(trading.address, minBuyAmt)
        await rToken.connect(addr1).approve(trading.address, minBuyAmtRToken)
        await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmt })
        await trading.placeBid(1, { bidder: addr1.address, sellAmount: sellAmtRToken, buyAmount: minBuyAmtRToken })

        // Close auctions
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionEnded')
          .withArgs(1, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken, Fate.Melt)
          .and.to.not.emit(assetManager, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        expectAuctionInfo(0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          fate: Fate.Stake,
          isOpen: false,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(1, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          fate: Fate.Melt,
          isOpen: false,
        })

        // State back to CALM
        expect(await main.state()).to.equal(State.CALM)
      })

      it('Should claimm AAVE and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        rewardAmountAAVE = bn('0.5e18')

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // AAVE Rewards
        await aToken.setRewards(newVault.address, rewardAmountAAVE)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())

        // Collect revenue - Called via poke
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountAAVE.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(assetManager, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken, Fate.Melt)

        // Check auctions registered
        // AAVE -> RSR Auction
        expectAuctionInfo(0, {
          sell: aaveAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })

        // AAVE -> RToken Auction
        expectAuctionInfo(1, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),

          fate: Fate.Melt,
          isOpen: true,
        })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(trading.address, minBuyAmt)
        await rToken.connect(addr1).approve(trading.address, minBuyAmtRToken)
        await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmt })
        await trading.placeBid(1, { bidder: addr1.address, sellAmount: sellAmtRToken, buyAmount: minBuyAmtRToken })

        // Close auctions
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionEnded')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken, Fate.Melt)
          .and.to.not.emit(assetManager, 'AuctionStarted')

        expectAuctionOpen(0, false)
        expectAuctionOpen(1, false)

        // State back to CALM
        expect(await main.state()).to.equal(State.CALM)
      })

      it('Should handle large auctions for using maxAuctionSize with f=1 (RSR only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        const newConfig: IManagerConfig = {
          rewardStart: config.rewardStart,
          rewardPeriod: config.rewardPeriod,
          auctionPeriod: config.auctionPeriod,
          stRSRWithdrawalDelay: config.stRSRWithdrawalDelay,
          defaultDelay: config.defaultDelay,
          maxTradeSlippage: config.maxTradeSlippage,
          maxAuctionSize: config.maxAuctionSize,
          minRecapitalizationAuctionSize: config.minRecapitalizationAuctionSize,
          minRevenueAuctionSize: config.minRevenueAuctionSize,
          migrationChunk: config.migrationChunk,
          issuanceRate: config.issuanceRate,
          defaultThreshold: config.defaultThreshold,
          f: fp('1'), // 100% to stakers
        }

        // update config
        await main.connect(owner).setConfig(newConfig)

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('2e18')

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // COMP Rewards
        await compoundMock.setRewards(newVault.address, rewardAmountCOMP)

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(newVault, 'RewardsClaimed')
          .withArgs(rewardAmountCOMP, 0)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // COMP -> RSR Auction
        expectAuctionInfo(0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(main.poke()).to.not.emit(assetManager, 'AuctionStarted')
        expect(await main.state()).to.equal(State.TRADING)

        // Check existing auctions still open
        expectAuctionOpen(0, true)

        // Advance time till auction ended
        await advanceTime(newConfig.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(trading.address, minBuyAmt)
        await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmt })

        // // Close auctions
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)

        // Check previous auctions closed
        // COMP -> RSR Auction
        expectAuctionInfo(0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(newConfig.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          fate: Fate.Stake,
          isOpen: false,
        })

        // State remains in TRADING
        expect(await main.state()).to.equal(State.TRADING)

        // COMP -> RSR Auction
        expectAuctionInfo(1, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(newConfig.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })
        // State remains in TRADING
        expect(await main.state()).to.equal(State.TRADING)

        // Advance time till auction ended
        await advanceTime(newConfig.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(trading.address, minBuyAmt)
        await trading.placeBid(1, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmt })

        // Close auction
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(1, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.not.emit(assetManager, 'AuctionStarted')

        // Check existing auctions are closed
        expectAuctionOpen(0, false)
        expectAuctionOpen(1, false)

        // State moved to CALM
        expect(await main.state()).to.equal(State.CALM)
      })

      it('Should handle large auctions for using maxAuctionSize with f=0 (RToken only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        const newConfig: IManagerConfig = {
          rewardStart: config.rewardStart,
          rewardPeriod: config.rewardPeriod,
          auctionPeriod: config.auctionPeriod,
          stRSRWithdrawalDelay: config.stRSRWithdrawalDelay,
          defaultDelay: config.defaultDelay,
          maxTradeSlippage: config.maxTradeSlippage,
          maxAuctionSize: config.maxAuctionSize,
          minRecapitalizationAuctionSize: config.minRecapitalizationAuctionSize,
          minRevenueAuctionSize: config.minRevenueAuctionSize,
          migrationChunk: config.migrationChunk,
          issuanceRate: config.issuanceRate,
          defaultThreshold: config.defaultThreshold,
          f: fp('0'), // 100% to RToken
        }

        // update config
        await main.connect(owner).setConfig(newConfig)

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1.5e18')

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // AAVE Rewards
        await aToken.setRewards(newVault.address, rewardAmountAAVE)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())

        // Collect revenue - Called via poke
        // Expected values based on Prices between AAVE and RToken = 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(newVault, 'RewardsClaimed')
          .withArgs(0, rewardAmountAAVE)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmt, minBuyAmt, Fate.Melt)

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // AAVE -> RToken Auction
        expectAuctionInfo(0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Melt,
          isOpen: true,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(main.poke()).to.not.emit(assetManager, 'AuctionStarted')
        expect(await main.state()).to.equal(State.TRADING)

        // Check existing auctions still open
        expectAuctionOpen(0, true)

        // Advance time till auction ended
        await advanceTime(newConfig.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rToken.connect(addr1).approve(trading.address, minBuyAmt)
        await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmt })

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Close auctions
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(0, aaveAsset.address, rTokenAsset.address, sellAmt, minBuyAmt, Fate.Melt)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRemainder, minBuyAmtRemainder, Fate.Melt)

        // Check previous auctions closed
        // AAVE -> RToken Auction
        expectAuctionInfo(0, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(newConfig.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          fate: Fate.Melt,
          isOpen: false,
        })

        // State remains in TRADING
        expect(await main.state()).to.equal(State.TRADING)

        // AAVE -> RToken Auction
        expectAuctionInfo(1, {
          sell: aaveAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(newConfig.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Melt,
          isOpen: true,
        })
        // State remains in TRADING
        expect(await main.state()).to.equal(State.TRADING)

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rToken.connect(addr1).approve(trading.address, sellAmtRemainder)
        await trading.placeBid(1, { bidder: addr1.address, sellAmount: sellAmtRemainder, buyAmount: sellAmtRemainder })

        // Advance time till auction ended
        await advanceTime(newConfig.auctionPeriod.add(100).toString())

        // Close auction
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(1, aaveAsset.address, rTokenAsset.address, sellAmtRemainder, sellAmtRemainder, Fate.Melt)
          .and.to.not.emit(assetManager, 'AuctionStarted')

        //  Check existing auctions are closed
        expectAuctionOpen(0, false)
        expectAuctionOpen(1, false)

        // State moved to CALM
        expect(await main.state()).to.equal(State.CALM)
      })

      it('Should handle large auctions using maxAuctionSize with revenue split RSR/RToken', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        const newConfig: IManagerConfig = {
          rewardStart: config.rewardStart,
          rewardPeriod: config.rewardPeriod,
          auctionPeriod: config.auctionPeriod,
          stRSRWithdrawalDelay: config.stRSRWithdrawalDelay,
          defaultDelay: config.defaultDelay,
          maxTradeSlippage: config.maxTradeSlippage,
          maxAuctionSize: fp('0.02'), // 2%
          minRecapitalizationAuctionSize: config.minRecapitalizationAuctionSize,
          minRevenueAuctionSize: config.minRevenueAuctionSize,
          migrationChunk: config.migrationChunk,
          issuanceRate: config.issuanceRate,
          defaultThreshold: config.defaultThreshold,
          f: fp('0.8'), // 80% to stakerss
        }

        // update config
        await main.connect(owner).setConfig(newConfig)

        // Set COMP tokens as reward
        // Based on current f -> 3.2e18 to RSR and 0.8e18 to Rtoken
        rewardAmountCOMP = bn('4e18')

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // COMP Rewards
        await compoundMock.setRewards(newVault.address, rewardAmountCOMP)

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).mul(2).div(100) // due to 2% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = sellAmt.div(4) // keep ratio of 1-f in each auction (Rtoken should be 25% of RSR in this example)
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(newVault, 'RewardsClaimed')
          .withArgs(rewardAmountCOMP, 0)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(1, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken, Fate.Melt)

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auctions registered
        // COMP -> RSR Auction
        expectAuctionInfo(0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(1, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Melt,
          isOpen: true,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(main.poke()).to.not.emit(assetManager, 'AuctionStarted')
        expect(await main.state()).to.equal(State.TRADING)

        // Check existing auctions still open
        expectAuctionOpen(0, true)
        expectAuctionOpen(1, true)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(trading.address, minBuyAmt)
        await rToken.connect(addr1).approve(trading.address, minBuyAmtRToken)
        await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmt })
        await trading.placeBid(1, { bidder: addr1.address, sellAmount: sellAmtRToken, buyAmount: minBuyAmtRToken })

        // Close auctions

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountCOMP.sub(sellAmt).sub(sellAmtRToken).mul(80).div(100) // f=0.8 of remaining funds
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        let sellAmtRTokenRemainder: BigNumber = sellAmtRemainder.div(4) // keep ratio of 1-f in each auction (Rtoken should be 25% of RSR in this example)
        let minBuyAmtRTokenRemainder: BigNumber = sellAmtRTokenRemainder.sub(sellAmtRTokenRemainder.div(100)) // due to trade slippage 1%

        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(0, compAsset.address, rsrAsset.address, sellAmt, minBuyAmt, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionEnded')
          .withArgs(1, compAsset.address, rTokenAsset.address, sellAmtRToken, minBuyAmtRToken, Fate.Melt)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(2, compAsset.address, rsrAsset.address, sellAmtRemainder, minBuyAmtRemainder, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(
            3,
            compAsset.address,
            rTokenAsset.address,
            sellAmtRTokenRemainder,
            minBuyAmtRTokenRemainder,
            Fate.Melt
          )

        // Check previous auctions closed
        // COMP -> RSR Auction
        expectAuctionInfo(0, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          fate: Fate.Stake,
          isOpen: false,
        })

        // COMP -> RToken Auction
        expectAuctionInfo(1, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          fate: Fate.Melt,
          isOpen: false,
        })

        // State remains in TRADING
        expect(await main.state()).to.equal(State.TRADING)

        expectAuctionInfo(2, {
          sell: compAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })

        expectAuctionInfo(3, {
          sell: compAsset.address,
          buy: rTokenAsset.address,
          sellAmount: sellAmtRTokenRemainder,
          minBuyAmount: minBuyAmtRTokenRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Melt,
          isOpen: true,
        })

        // Check auctions open/closed
        expectAuctionOpen(0, false)
        expectAuctionOpen(1, false)
        expectAuctionOpen(2, true)
        expectAuctionOpen(3, true)

        // State remains in TRADING
        expect(await main.state()).to.equal(State.TRADING)

        // Run final auction until all funds are converted
        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(trading.address, minBuyAmtRemainder)
        await rToken.connect(addr1).approve(trading.address, minBuyAmtRTokenRemainder)
        await trading.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })
        await trading.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmtRTokenRemainder,
          buyAmount: minBuyAmtRTokenRemainder,
        })

        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          .withArgs(2, compAsset.address, rsrAsset.address, sellAmtRemainder, minBuyAmtRemainder, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionEnded')
          .withArgs(
            3,
            compAsset.address,
            rTokenAsset.address,
            sellAmtRTokenRemainder,
            minBuyAmtRTokenRemainder,
            Fate.Melt
          )
          .and.to.not.emit(assetManager, 'AuctionStarted')

        // Check all auctions are closed
        expectAuctionOpen(0, false)
        expectAuctionOpen(1, false)
        expectAuctionOpen(2, false)
        expectAuctionOpen(3, false)

        // State is now CALM
        expect(await main.state()).to.equal(State.CALM)
      })

      it('Should mint RTokens when collateral appreciates and handle revenue auction correctly', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Get RToken Asset
        const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())

        // Change redemption rate for AToken and CToken to double
        await aToken.setExchangeRate(fp('2'))
        await cToken.setExchangeRate(fp('2'))

        // f = fp(0.6) = 40% increase in price of RToken -> (1 + 0.4) / 2 = 7/10
        let b = fp(1)
          .add(bn(2 - 1).mul(fp(1).sub(config.f)))
          .div(bn(2))

        // Check base factor
        expect(await assetManager.baseFactor()).to.equal(b)

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // Total value being auctioned = sellAmount * new price (1.4) - This is the exact amount of RSR required (because RSR = 1 USD )
        // Note: for rounding division by 10 is done later in calculation
        let currentTotalSupply: BigNumber = await rToken.totalSupply()
        let newTotalSupply: BigNumber = fp(currentTotalSupply).div(b)
        let sellAmt: BigNumber = newTotalSupply.div(100) // due to max auction size of 1%
        let tempValueSell = sellAmt.mul(14)
        let minBuyAmtRSR: BigNumber = tempValueSell.sub(tempValueSell.mul(config.maxTradeSlippage).div(BN_SCALE_FACTOR)) // due to trade slippage 1%
        minBuyAmtRSR = minBuyAmtRSR.div(10)

        // Call Poke to collect revenue and mint new tokens
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionStarted')
          .withArgs(0, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR, Fate.Stake)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        expectAuctionInfo(0, {
          sell: rTokenAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmtRSR,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })

        // Check new state
        expect(await main.state()).to.equal(State.TRADING)

        // Perform Mock Bids for RSR(addr1 has balance)
        await rsr.connect(addr1).approve(trading.address, minBuyAmtRSR)
        await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: minBuyAmtRSR })

        // Advance time till auctioo ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Call poke to end current auction, should start a new one with same amount
        await expect(main.poke())
          .to.emit(assetManager, 'AuctionEnded')
          //.withArgs(0, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR, Fate.Stake)
          .and.to.emit(assetManager, 'AuctionStarted')
          .withArgs(1, rTokenAsset.address, rsrAsset.address, sellAmt, minBuyAmtRSR, Fate.Stake)

        // Check new auction
        expectAuctionInfo(1, {
          sell: rTokenAsset.address,
          buy: rsrAsset.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmtRSR,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          fate: Fate.Stake,
          isOpen: true,
        })
      })
    })
  })

  describe('Recapitalization', () => {
    context('With very simple Basket - Single stablecoin', async function () {
      let issueAmount: BigNumber
      let backupVault: VaultP0
      let newVault: VaultP0

      beforeEach(async function () {
        // For simple vault with one token (1 to 1) - And backup
        backupVault = <VaultP0>await VaultFactory.deploy([collateral[1]], [bn('1e18')], [])

        newVault = <VaultP0>await VaultFactory.deploy([collateral[0]], [bn('1e18')], [backupVault.address])

        console.log('Token in basket: ' + (await token0.address))
        console.log('Backup token: ' + (await token1.address))

        // Setup Main
        await newVault.connect(owner).setMain(main.address)

        // Switch Vault
        await assetManager.connect(owner).switchVault(newVault.address)

        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await token0.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        console.log('Balance Before: ' + (await token0.balanceOf(assetManager.address)))
        console.log('Balance Before- Vault: ' + (await token0.balanceOf(vault.address)))

        // Process the issuance
        await main.poke()

        console.log('Balance After: ' + (await token0.balanceOf(assetManager.address)))
        console.log('Balance After - Vault: ' + (await token0.balanceOf(newVault.address)))
      })

      it.skip('Should recapitalize correctly in case of default', async () => {
        // Set Token0 to default
        await aaveOracle.setPrice(token0.address, bn('1.5e14'))

        // Check initial state
        expect(await main.state()).to.equal(State.CALM)

        // Running auctions will not trigger recapitalization until default flag is up
        await expect(main.poke()).to.not.emit(assetManager, 'AuctionStarted')

        // Notice default
        await expect(main.noticeDefault()).to.emit(main, 'SystemStateChanged').withArgs(State.CALM, State.DOUBT)

        // Check initial state
        expect(await main.state()).to.equal(State.DOUBT)

        // Cannot run again poke during Doubt state
        await expect(main.poke()).to.be.revertedWith('only during calm + trading')

        // Advance time post defaultDelay
        await advanceTime(config.defaultDelay.toString())

        await expect(main.noticeDefault()).to.emit(main, 'SystemStateChanged').withArgs(State.DOUBT, State.TRADING)

        // Check state
        expect(await main.state()).to.equal(State.TRADING)
        expect(await assetManager.vault()).to.equal(backupVault.address)
        expect(await assetManager.fullyCapitalized()).to.equal(false)

        // Now run recapitalization auction
        await expect(main.poke()).to.emit(assetManager, 'AuctionStarted')
      })
    })
  })
})
