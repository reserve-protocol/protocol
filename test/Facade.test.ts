import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { expectEvents } from '../common/events'
import { IConfig, IMonitorParams } from '#/common/configuration'
import { bn, fp } from '../common/numbers'
import { setOraclePrice } from './utils/oracles'
import { disableBatchTrade, disableDutchTrade } from './utils/trades'
import { whileImpersonating } from './utils/impersonation'
import {
  Asset,
  BackingManagerP1,
  BackingMgrCompatibleV1,
  BackingMgrCompatibleV2,
  BackingMgrInvalidVersion,
  ComptrollerMock,
  CTokenMock,
  ERC20Mock,
  FacadeMonitor,
  FacadeMonitorV2,
  FacadeTest,
  MockV3Aggregator,
  ReadFacet,
  RecollateralizationLibP1,
  RevertingFacetMock,
  RevenueTraderCompatibleV1,
  RevenueTraderCompatibleV2,
  RevenueTraderInvalidVersion,
  RevenueTraderP1,
  StaticATokenMock,
  StRSRP1,
  IAssetRegistry,
  IBasketHandler,
  TestIBackingManager,
  TestIBroker,
  TestIFacade,
  TestIRevenueTrader,
  TestIMain,
  TestIStRSR,
  TestIRToken,
  USDCMock,
} from '../typechain'
import { advanceTime } from './utils/time'
import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  defaultFixture,
  ORACLE_ERROR,
  DECAY_DELAY,
  PRICE_TIMEOUT,
} from './fixtures'
import { advanceToTimestamp, getLatestBlockTimestamp, setNextBlockTimestamp } from './utils/time'
import { CollateralStatus, TradeKind, MAX_UINT256, ZERO_ADDRESS } from '#/common/constants'
import { expectTrade } from './utils/trades'
import { mintCollaterals } from './utils/tokens'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

const itP1 = IMPLEMENTATION == Implementation.P1 ? it : it.skip

describe('Facade + FacadeMonitor contracts', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMock
  let rsr: ERC20Mock
  let basket: Collateral[]

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Facade
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let facadeMonitor: FacadeMonitor
  let readFacet: ReadFacet

  // Main
  let rToken: TestIRToken
  let main: TestIMain
  let stRSR: TestIStRSR
  let basketHandler: IBasketHandler
  let rTokenTrader: TestIRevenueTrader
  let rsrTrader: TestIRevenueTrader
  let backingManager: TestIBackingManager
  let broker: TestIBroker
  let assetRegistry: IAssetRegistry

  // RSR
  let rsrAsset: Asset

  // Config values
  let config: IConfig

  // Factories
  let RevenueTraderV2ImplFactory: ContractFactory
  let RevenueTraderV1ImplFactory: ContractFactory
  let RevenueTraderInvalidVerImplFactory: ContractFactory
  let BackingMgrV2ImplFactory: ContractFactory
  let BackingMgrV1ImplFactory: ContractFactory
  let BackingMgrInvalidVerImplFactory: ContractFactory

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      stRSR,
      aaveToken,
      compToken,
      compoundMock,
      rsr,
      rsrAsset,
      basket,
      config,
      facade,
      readFacet,
      facadeTest,
      facadeMonitor,
      rToken,
      main,
      basketHandler,
      backingManager,
      rTokenTrader,
      rsrTrader,
      broker,
      assetRegistry,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    ;[tokenAsset, usdcAsset, aTokenAsset, cTokenAsset] = basket

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())

    // Factories used in tests
    RevenueTraderV2ImplFactory = await ethers.getContractFactory('RevenueTraderCompatibleV2')

    RevenueTraderV1ImplFactory = await ethers.getContractFactory('RevenueTraderCompatibleV1')

    RevenueTraderInvalidVerImplFactory = await ethers.getContractFactory(
      'RevenueTraderInvalidVersion'
    )

    const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
      await (await ethers.getContractFactory('RecollateralizationLibP1')).deploy()
    )

    BackingMgrV2ImplFactory = await ethers.getContractFactory('BackingMgrCompatibleV2', {
      libraries: {
        RecollateralizationLibP1: tradingLib.address,
      },
    })

    BackingMgrV1ImplFactory = await ethers.getContractFactory('BackingMgrCompatibleV1', {
      libraries: {
        RecollateralizationLibP1: tradingLib.address,
      },
    })

    BackingMgrInvalidVerImplFactory = await ethers.getContractFactory('BackingMgrInvalidVersion', {
      libraries: {
        RecollateralizationLibP1: tradingLib.address,
      },
    })
  })

  describe('Facade', () => {
    let selector: string
    let revertingFacet: RevertingFacetMock

    beforeEach(async () => {
      selector = readFacet.interface.getSighash('backingOverview(address)')
      const factory = await ethers.getContractFactory('RevertingFacetMock')
      revertingFacet = await factory.deploy()
    })

    it('Cannot save zero addr facets', async () => {
      await expect(facade.save(ZERO_ADDRESS, [selector])).to.be.revertedWith('zero address')
    })
    it('Can overwrite an entry', async () => {
      await expect(facade.save(revertingFacet.address, [selector]))
        .to.emit(facade, 'SelectorSaved')
        .withArgs(revertingFacet.address, selector)
      await expect(facade.backingOverview(rToken.address)).to.be.revertedWith('RevertingFacetMock')
    })
  })

  describe('Facets', () => {
    let issueAmount: BigNumber

    const expectValidBasketBreakdown = async (rToken: TestIRToken) => {
      const [erc20s, breakdown, targets] = await facade.callStatic.basketBreakdown(rToken.address)
      expect(erc20s.length).to.equal(4)
      expect(breakdown.length).to.equal(4)
      expect(targets.length).to.equal(4)
      expect(erc20s[0]).to.equal(token.address)
      expect(erc20s[1]).to.equal(usdc.address)
      expect(erc20s[2]).to.equal(aToken.address)
      expect(erc20s[3]).to.equal(cToken.address)
      expect(breakdown[0]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[1]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[2]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[3]).to.be.closeTo(fp('0.25'), 10)
      expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
    }

    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('10000000000e18')
      await mintCollaterals(owner, [addr1, addr2], initialBal, basket)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('should return the correct facade address', async () => {
      expect(await facade.stToken(rToken.address)).to.equal(stRSR.address)
    })

    it('Should return maxIssuable correctly', async () => {
      // Regression test
      // April 2nd 2024 -- maxIssuableByAmounts did not account for appreciation
      // Cause RToken appreciation first to ensure basketsNeeded != totalSupply
      const meltAmt = issueAmount.div(10)
      const furnaceAddr = await main.furnace()
      await rToken.connect(addr1).transfer(furnaceAddr, meltAmt)
      await whileImpersonating(furnaceAddr, async (furnaceSigner) => {
        await rToken.connect(furnaceSigner).melt(meltAmt)
      })

      // Check values -- must reflect 10% appreciation
      expect(await facade.callStatic.maxIssuable(rToken.address, addr1.address)).to.equal(
        bn('3.599999991e28')
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        bn('3.6e28')
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, other.address)).to.equal(0)

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(await rToken.totalSupply())
      expect(await rToken.totalSupply()).to.equal(0)
      expect(await rToken.basketsNeeded()).to.equal(0)

      // With 0 baskets needed - Returns correct value at 1:1 rate, without the 10%
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        bn('4e28')
      )
    })

    it('Should return maxIssuableByAmounts correctly', async () => {
      const [erc20Addrs] = await basketHandler.quote(fp('1'), false, 0)
      const erc20s = await Promise.all(erc20Addrs.map((a) => ethers.getContractAt('ERC20Mock', a)))
      const addr1Amounts = await Promise.all(erc20s.map((e) => e.balanceOf(addr1.address)))
      const addr2Amounts = await Promise.all(erc20s.map((e) => e.balanceOf(addr2.address)))
      const otherAmounts = await Promise.all(erc20s.map((e) => e.balanceOf(other.address)))

      // Regression test
      // April 2nd 2024 -- maxIssuableByAmounts did not account for appreciation
      // Cause RToken appreciation first to ensure basketsNeeded != totalSupply
      const meltAmt = issueAmount.div(10)
      const furnaceAddr = await main.furnace()
      await rToken.connect(addr1).transfer(furnaceAddr, meltAmt)
      await whileImpersonating(furnaceAddr, async (furnaceSigner) => {
        await rToken.connect(furnaceSigner).melt(meltAmt)
      })

      // Check values -- must reflect 10% appreciation
      expect(await facade.callStatic.maxIssuableByAmounts(rToken.address, addr1Amounts)).to.equal(
        bn('3.599999991e28')
      )
      expect(await facade.callStatic.maxIssuableByAmounts(rToken.address, addr2Amounts)).to.equal(
        bn('3.6e28')
      )
      expect(await facade.callStatic.maxIssuableByAmounts(rToken.address, otherAmounts)).to.equal(0)

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(await rToken.totalSupply())
      expect(await rToken.totalSupply()).to.equal(0)
      expect(await rToken.basketsNeeded()).to.equal(0)
      const newAddr2Amounts = await Promise.all(erc20s.map((e) => e.balanceOf(addr2.address)))

      // With 0 baskets needed - Returns correct value at 1:1 rate, without the 10%
      expect(
        await facade.callStatic.maxIssuableByAmounts(rToken.address, newAddr2Amounts)
      ).to.equal(bn('4e28'))
    })

    it('Should revert maxIssuable when frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(facade.callStatic.maxIssuable(rToken.address, addr1.address)).to.be.revertedWith(
        'frozen'
      )
    })

    it('Should return issuable quantities correctly', async () => {
      const [toks, quantities, uoas] = await facade.callStatic.issue(rToken.address, issueAmount)
      expect(toks.length).to.equal(4)
      expect(toks[0]).to.equal(token.address)
      expect(toks[1]).to.equal(usdc.address)
      expect(toks[2]).to.equal(aToken.address)
      expect(toks[3]).to.equal(cToken.address)
      expect(quantities.length).to.equal(4)
      expect(quantities[0]).to.equal(issueAmount.div(4))
      expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(quantities[2]).to.equal(issueAmount.div(4))
      expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
      expect(uoas.length).to.equal(4)
      expect(uoas[0]).to.equal(issueAmount.div(4))
      expect(uoas[1]).to.equal(issueAmount.div(4))
      expect(uoas[2]).to.equal(issueAmount.div(4))
      expect(uoas[3]).to.equal(issueAmount.div(4))
    })

    it('Should handle UNPRICED when returning issuable quantities', async () => {
      // Set unpriced assets, should return UoA = 0
      await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())
      const [toks, quantities, uoas] = await facade.callStatic.issue(rToken.address, issueAmount)
      expect(toks.length).to.equal(4)
      expect(toks[0]).to.equal(token.address)
      expect(toks[1]).to.equal(usdc.address)
      expect(toks[2]).to.equal(aToken.address)
      expect(toks[3]).to.equal(cToken.address)
      expect(quantities.length).to.equal(4)
      expect(quantities[0]).to.equal(issueAmount.div(4))
      expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(quantities[2]).to.equal(issueAmount.div(4))
      expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
      expect(uoas.length).to.equal(4)
      // Assets are unpriced
      expect(uoas[0]).to.equal(0)
      expect(uoas[1]).to.equal(0)
      expect(uoas[2]).to.equal(0)
      expect(uoas[3]).to.equal(0)
    })

    it('Should revert when returning issuable quantities if frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(facade.callStatic.issue(rToken.address, issueAmount)).to.be.revertedWith(
        'frozen'
      )
    })

    it('Should return redeemable quantities correctly', async () => {
      const [toks, quantities, available] = await facade.callStatic.redeem(
        rToken.address,
        issueAmount
      )
      expect(toks.length).to.equal(4)
      expect(toks[0]).to.equal(token.address)
      expect(toks[1]).to.equal(usdc.address)
      expect(toks[2]).to.equal(aToken.address)
      expect(toks[3]).to.equal(cToken.address)
      expect(quantities[0]).to.equal(issueAmount.div(4))
      expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(quantities[2]).to.equal(issueAmount.div(4))
      expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
      expect(available[0]).to.equal(issueAmount.div(4))
      expect(available[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(available[2]).to.equal(issueAmount.div(4))
      expect(available[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))

      // redeemCustom
      const [toksCustom, quantitiesCustom] = await facade.callStatic.redeemCustom(
        rToken.address,
        issueAmount,
        [await basketHandler.nonce()],
        [fp('1')]
      )
      expect(toksCustom.length).to.equal(4)
      expect(toksCustom[0]).to.equal(token.address)
      expect(toksCustom[1]).to.equal(usdc.address)
      expect(toksCustom[2]).to.equal(aToken.address)
      expect(toksCustom[3]).to.equal(cToken.address)
      expect(quantitiesCustom[0]).to.equal(issueAmount.div(4))
      expect(quantitiesCustom[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(quantitiesCustom[2]).to.equal(issueAmount.div(4))
      expect(quantitiesCustom[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))

      // Prorata case -- burn half
      await token.burn(await main.backingManager(), issueAmount.div(8))
      const [newToks, newQuantities, newAvailable] = await facade.callStatic.redeem(
        rToken.address,
        issueAmount
      )
      expect(newToks[0]).to.equal(token.address)
      expect(newQuantities[0]).to.equal(issueAmount.div(4))
      expect(newAvailable[0]).to.equal(issueAmount.div(4).div(2))

      // redeemCustom
      const [newToksCustom, newQuantitiesCustom] = await facade.callStatic.redeemCustom(
        rToken.address,
        issueAmount,
        [await basketHandler.nonce()],
        [fp('1')]
      )
      expect(newToksCustom.length).to.equal(4)
      expect(newToksCustom[0]).to.equal(token.address)
      expect(newToksCustom[1]).to.equal(usdc.address)
      expect(newToksCustom[2]).to.equal(aToken.address)
      expect(newToksCustom[3]).to.equal(cToken.address)
      expect(newQuantitiesCustom[0]).to.equal(issueAmount.div(4).div(2))
      expect(newQuantitiesCustom[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(newQuantitiesCustom[2]).to.equal(issueAmount.div(4))
      expect(newQuantitiesCustom[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))

      // refreshBasket()
      await basketHandler.connect(owner).refreshBasket()
      await expect(facade.callStatic.redeem(rToken.address, issueAmount)).not.to.be.reverted
      const [prevBasketTokens, prevBasketQuantities] = await facade.callStatic.redeemCustom(
        rToken.address,
        issueAmount,
        [(await basketHandler.nonce()) - 1],
        [fp('1')]
      )
      expect(prevBasketTokens.length).to.equal(4)
      expect(prevBasketTokens[0]).to.equal(token.address)
      expect(prevBasketTokens[1]).to.equal(usdc.address)
      expect(prevBasketTokens[2]).to.equal(aToken.address)
      expect(prevBasketTokens[3]).to.equal(cToken.address)
      expect(prevBasketQuantities[0]).to.equal(issueAmount.div(4).div(2))
      expect(prevBasketQuantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(prevBasketQuantities[2]).to.equal(issueAmount.div(4))
      expect(prevBasketQuantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
    })

    it('Should revert when returning redeemable quantities if frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(facade.callStatic.redeem(rToken.address, issueAmount)).to.be.revertedWith(
        'frozen'
      )

      await expect(
        facade.callStatic.redeemCustom(
          rToken.address,
          issueAmount,
          [await basketHandler.nonce()],
          [fp('1')]
        )
      ).to.be.revertedWith('frozen')
    })

    it('Should revert if portions do not sum to FIX_ONE in redeem custom', async function () {
      const nonce = await basketHandler.nonce()
      await expect(
        facade.callStatic.redeemCustom(
          rToken.address,
          issueAmount,
          [nonce, nonce],
          [fp('0.5'), fp('0.5').add(1)]
        )
      ).to.be.revertedWith('portions do not add up to FIX_ONE')
    })

    it('Should return backingOverview correctly', async () => {
      let [backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)

      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully collateralized and fully over-collateralized
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.be.closeTo(fp('0.5'), 10)

      // Stake more RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(fp('1'))

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount)

      // Check values = 0 (no supply)
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - No supply, returns 0
      expect(backing).to.equal(0)
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when undercollateralized', async () => {
      const backingManager = await main.backingManager()
      await usdc.burn(backingManager, (await usdc.balanceOf(backingManager)).div(2))
      await basketHandler.refreshBasket()
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('0.875'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when an asset price is 0', async () => {
      await setOraclePrice(tokenAsset.address, bn(0))
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when basket collateral is UNPRICED', async () => {
      await setOraclePrice(tokenAsset.address, MAX_UINT256.div(2).sub(1))
      await basketHandler.refreshBasket()
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1')) // since price is unknown for uoaHeldInBaskets
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview over-collateralization correctly when RSR price is 0', async () => {
      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)

      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(fp('0.5'))

      // Set price to 0
      await setOraclePrice(rsrAsset.address, bn(0))
      await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())
      await setOraclePrice(tokenAsset.address, bn('1e8'))
      await setOraclePrice(usdcAsset.address, bn('1e8'))
      await assetRegistry.refresh()

      const [backing2, overCollateralization2] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing2).to.equal(fp('1'))
      expect(overCollateralization2).to.equal(0)
    })

    it('Should return backingOverview backing correctly when RSR is UNPRICED', async () => {
      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)

      // Check values - Fully collateralized and with 50%-collateralization
      let [backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(fp('0.5'))

      await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())
      await setOraclePrice(tokenAsset.address, bn('1e8'))
      await setOraclePrice(usdcAsset.address, bn('1e8'))
      await assetRegistry.refresh()
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return balancesAcrossAllTraders correctly', async () => {
      // Send 1 token to rTokenTrader; 2 to rsrTrader
      await token.connect(addr1).transfer(rTokenTrader.address, 1)
      await token.connect(addr1).transfer(rsrTrader.address, 2)
      await usdc.connect(addr1).transfer(rTokenTrader.address, 1)
      await usdc.connect(addr1).transfer(rsrTrader.address, 2)
      await aToken.connect(addr1).transfer(rTokenTrader.address, 1)
      await aToken.connect(addr1).transfer(rsrTrader.address, 2)
      await cToken.connect(addr1).transfer(rTokenTrader.address, 1)
      await cToken.connect(addr1).transfer(rsrTrader.address, 2)

      // Balances
      const [erc20s, balances, balancesNeededByBackingManager] =
        await facade.callStatic.balancesAcrossAllTraders(rToken.address)
      expect(erc20s.length).to.equal(8)
      expect(balances.length).to.equal(8)
      expect(balancesNeededByBackingManager.length).to.equal(8)

      for (let i = 0; i < 8; i++) {
        let bal = bn('0')
        if (erc20s[i] == token.address) bal = issueAmount.div(4)
        if (erc20s[i] == usdc.address) bal = issueAmount.div(4).div(bn('1e12'))
        if (erc20s[i] == aToken.address) bal = issueAmount.div(4)
        if (erc20s[i] == cToken.address) bal = issueAmount.div(4).mul(50).div(bn('1e10'))

        if ([token.address, usdc.address, aToken.address, cToken.address].indexOf(erc20s[i]) >= 0) {
          expect(balances[i]).to.equal(bal.add(3)) // expect 3 more
          expect(balancesNeededByBackingManager[i]).to.equal(bal)
        } else {
          expect(balances[i]).to.equal(0)
          expect(balancesNeededByBackingManager[i]).to.equal(0)
        }
      }
    })

    it('Should return revenue + chain into ActFacet.runRevenueAuctions', async () => {
      // Set low to 0 == revenueOverview() should not revert
      const minTradeVolume = await rsrTrader.minTradeVolume()
      const auctionLength = await broker.dutchAuctionLength()
      const tokenSurplus = bn('0.5e18')
      await token.connect(addr1).transfer(rsrTrader.address, tokenSurplus)

      await setOraclePrice(usdcAsset.address, bn('0'))
      await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())
      await setOraclePrice(tokenAsset.address, bn('1e8'))
      await setOraclePrice(rsrAsset.address, bn('1e8'))
      await assetRegistry.refresh()

      const [low] = await usdcAsset.price()
      expect(low).to.equal(0)

      // revenue
      let [erc20s, canStart, surpluses, minTradeAmounts] = await facade.callStatic.revenueOverview(
        rsrTrader.address
      )
      expect(erc20s.length).to.equal(8) // should be full set of registered ERC20s

      const erc20sToStart = []
      for (let i = 0; i < 8; i++) {
        if (erc20s[i] == token.address) {
          erc20sToStart.push(erc20s[i])
          expect(canStart[i]).to.equal(true)
          expect(surpluses[i]).to.equal(tokenSurplus)
        } else {
          expect(canStart[i]).to.equal(false)
          expect(surpluses[i]).to.equal(0)
        }
        const asset = await ethers.getContractAt('IAsset', await assetRegistry.toAsset(erc20s[i]))
        const [low] = await asset.price()
        expect(minTradeAmounts[i]).to.equal(
          low.gt(0) ? minTradeVolume.mul(bn('10').pow(await asset.erc20Decimals())).div(low) : 0
        ) // 1% oracleError
      }

      // Run revenue auctions via multicall
      const funcSig = ethers.utils.id('runRevenueAuctions(address,address[],address[],uint8[])')
      const args = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address[]', 'address[]', 'uint8[]'],
        [rsrTrader.address, [], erc20sToStart, [TradeKind.DUTCH_AUCTION]]
      )
      const data = funcSig.substring(0, 10) + args.slice(2)
      const facadeAsActFacet = await ethers.getContractAt('ActFacet', facade.address)
      await expect(facadeAsActFacet.multicall([data])).to.emit(rsrTrader, 'TradeStarted')

      // Another call to revenueOverview should not propose any auction
      ;[erc20s, canStart, surpluses, minTradeAmounts] = await facade.callStatic.revenueOverview(
        rsrTrader.address
      )
      expect(canStart).to.eql(Array(8).fill(false))

      // Nothing should be settleable
      expect((await facade.auctionsSettleable(rsrTrader.address)).length).to.equal(0)

      // Advance time till auction is over
      await advanceToTimestamp((await getLatestBlockTimestamp()) + auctionLength + 13)

      // Now should be settleable
      const settleable = await facade.auctionsSettleable(rsrTrader.address)
      expect(settleable.length).to.equal(1)
      expect(settleable[0]).to.equal(token.address)

      // Another call to revenueOverview should settle and propose new auction
      ;[erc20s, canStart, surpluses, minTradeAmounts] = await facade.callStatic.revenueOverview(
        rsrTrader.address
      )

      // Should repeat the same auctions
      for (let i = 0; i < 8; i++) {
        if (erc20s[i] == token.address) {
          expect(canStart[i]).to.equal(true)
          expect(surpluses[i]).to.equal(tokenSurplus)
        } else {
          expect(canStart[i]).to.equal(false)
          expect(surpluses[i]).to.equal(0)
        }
      }

      // Settle and start new auction
      await facade.runRevenueAuctions(rsrTrader.address, erc20sToStart, erc20sToStart, [
        TradeKind.DUTCH_AUCTION,
      ])

      // Send additional revenues
      await token.connect(addr1).transfer(rsrTrader.address, tokenSurplus)

      // Call revenueOverview, cannot open new auctions
      ;[erc20s, canStart, surpluses, minTradeAmounts] = await facade.callStatic.revenueOverview(
        rsrTrader.address
      )
      expect(canStart).to.eql(Array(8).fill(false))
    })

    itP1('Should handle invalid versions when running revenueOverview', async () => {
      // Use P1 specific versions
      rsrTrader = <RevenueTraderP1>await ethers.getContractAt('RevenueTraderP1', rsrTrader.address)
      backingManager = <BackingManagerP1>(
        await ethers.getContractAt('BackingManagerP1', backingManager.address)
      )

      const bckMgrInvalidVer: BackingMgrInvalidVersion = <BackingMgrInvalidVersion>(
        await BackingMgrInvalidVerImplFactory.deploy()
      )

      await expect(facade.callStatic.revenueOverview(rsrTrader.address)).not.to.be.reverted

      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(bckMgrInvalidVer.address)
      })

      // Reverts due to invalid version when forwarding revenue
      await expect(facade.callStatic.revenueOverview(rsrTrader.address)).to.be.revertedWith(
        'unrecognized version'
      )
    })

    it('Should return nextRecollateralizationAuction', async () => {
      // Confirm no auction to run yet - should not revert
      let [canStart, sell, buy, sellAmount] =
        await facade.callStatic.nextRecollateralizationAuction(
          backingManager.address,
          TradeKind.DUTCH_AUCTION
        )
      expect(canStart).to.equal(false)

      // Setup prime basket
      await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])

      // Switch Basket
      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [usdc.address], [fp('1')], false)

      // Trigger recollateralization
      const sellAmt: BigNumber = await token.balanceOf(backingManager.address)

      // Confirm nextRecollateralizationAuction is true
      ;[canStart, sell, buy, sellAmount] = await facade.callStatic.nextRecollateralizationAuction(
        backingManager.address,
        TradeKind.DUTCH_AUCTION
      )
      expect(canStart).to.equal(true)
      expect(sell).to.equal(token.address)
      expect(buy).to.equal(usdc.address)
      expect(sellAmount).to.equal(sellAmt)

      // Trigger auction
      await backingManager.rebalance(TradeKind.BATCH_AUCTION)

      const auctionTimestamp: number = await getLatestBlockTimestamp()

      // Check auction registered
      // token -> usdc Auction
      await expectTrade(backingManager, {
        sell: token.address,
        buy: usdc.address,
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: bn('0'),
      })

      // nextRecollateralizationAuction should return false (trade open)
      ;[canStart, sell, buy, sellAmount] = await facade.callStatic.nextRecollateralizationAuction(
        backingManager.address,
        TradeKind.DUTCH_AUCTION
      )
      expect(canStart).to.equal(false)
      expect(sell).to.equal(ZERO_ADDRESS)
      expect(buy).to.equal(ZERO_ADDRESS)
      expect(sellAmount).to.equal(0)

      //  Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // nextRecollateralizationAuction should return the next trade
      // In this case it will retry the same auction
      ;[canStart, sell, buy, sellAmount] = await facade.callStatic.nextRecollateralizationAuction(
        backingManager.address,
        TradeKind.DUTCH_AUCTION
      )
      expect(canStart).to.equal(true)
      expect(sell).to.equal(token.address)
      expect(buy).to.equal(usdc.address)
      expect(sellAmount).to.equal(sellAmt)
    })

    itP1('Should handle other versions for nextRecollateralizationAuction', async () => {
      // Use P1 specific versions
      backingManager = <BackingManagerP1>(
        await ethers.getContractAt('BackingManagerP1', backingManager.address)
      )

      const backingManagerV2: BackingMgrCompatibleV2 = <BackingMgrCompatibleV2>(
        await BackingMgrV2ImplFactory.deploy()
      )

      const backingManagerV1: BackingMgrCompatibleV1 = <BackingMgrCompatibleV1>(
        await BackingMgrV1ImplFactory.deploy()
      )

      const backingManagerInvalidVer: BackingMgrInvalidVersion = <BackingMgrInvalidVersion>(
        await BackingMgrInvalidVerImplFactory.deploy()
      )

      // Upgrade BackingManager to V2
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerV2.address)
      })

      // Confirm no auction to run yet - should not revert
      let [canStart, sell, buy, sellAmount] =
        await facade.callStatic.nextRecollateralizationAuction(
          backingManager.address,
          TradeKind.BATCH_AUCTION
        )
      expect(canStart).to.equal(false)

      // Setup prime basket
      await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])

      // Switch Basket
      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [usdc.address], [fp('1')], false)

      // Trigger recollateralization
      const sellAmt: BigNumber = await token.balanceOf(backingManager.address)

      // Confirm nextRecollateralizationAuction is true
      ;[canStart, sell, buy, sellAmount] = await facade.callStatic.nextRecollateralizationAuction(
        backingManager.address,
        TradeKind.BATCH_AUCTION
      )
      expect(canStart).to.equal(true)
      expect(sell).to.equal(token.address)
      expect(buy).to.equal(usdc.address)
      expect(sellAmount).to.equal(sellAmt)

      // Trigger auction
      await backingManager.rebalance(TradeKind.BATCH_AUCTION)

      const auctionTimestamp: number = await getLatestBlockTimestamp()

      // Check auction registered
      // token -> usdc Auction
      await expectTrade(backingManager, {
        sell: token.address,
        buy: usdc.address,
        endTime: auctionTimestamp + Number(config.batchAuctionLength),
        externalId: bn('0'),
      })

      // Upgrade BackingManager to V1
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerV1.address)
      })

      // nextRecollateralizationAuction should return false (trade open)
      ;[canStart, sell, buy, sellAmount] = await facade.callStatic.nextRecollateralizationAuction(
        backingManager.address,
        TradeKind.BATCH_AUCTION
      )
      expect(canStart).to.equal(false)
      expect(sell).to.equal(ZERO_ADDRESS)
      expect(buy).to.equal(ZERO_ADDRESS)
      expect(sellAmount).to.equal(0)

      //  Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // nextRecollateralizationAuction should return the next trade
      // In this case it will retry the same auction
      ;[canStart, sell, buy, sellAmount] = await facade.callStatic.nextRecollateralizationAuction(
        backingManager.address,
        TradeKind.BATCH_AUCTION
      )
      expect(canStart).to.equal(true)
      expect(sell).to.equal(token.address)
      expect(buy).to.equal(usdc.address)
      expect(sellAmount).to.equal(sellAmt)

      // Invalid versions are also handled
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerInvalidVer.address)
      })

      await expect(
        facade.callStatic.nextRecollateralizationAuction(
          backingManager.address,
          TradeKind.BATCH_AUCTION
        )
      ).to.be.revertedWith('unrecognized version')
    })

    itP1('Should handle invalid versions for nextRecollateralizationAuction', async () => {
      // Use P1 specific versions
      backingManager = <BackingManagerP1>(
        await ethers.getContractAt('BackingManagerP1', backingManager.address)
      )

      const backingManagerInvalidVer: BackingMgrInvalidVersion = <BackingMgrInvalidVersion>(
        await BackingMgrInvalidVerImplFactory.deploy()
      )

      // Upgrade BackingManager to Invalid version
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerInvalidVer.address)
      })

      // Setup prime basket
      await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])

      // Switch Basket
      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [usdc.address], [fp('1')], false)

      // Attempt to trigger recollateralization
      await expect(
        facade.callStatic.nextRecollateralizationAuction(
          backingManager.address,
          TradeKind.BATCH_AUCTION
        )
      ).to.be.revertedWith('unrecognized version')
    })

    it('Should return basketBreakdown correctly for paused token', async () => {
      await main.connect(owner).pauseTrading()
      await expectValidBasketBreakdown(rToken)
    })

    it('Should return basketBreakdown correctly when RToken supply = 0', async () => {
      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount)

      expect(await rToken.totalSupply()).to.equal(bn(0))

      await expectValidBasketBreakdown(rToken)
    })

    it('Should return basketBreakdown correctly for tokens with (0, FIX_MAX) price', async () => {
      const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
        await ethers.getContractAt('MockV3Aggregator', await tokenAsset.chainlinkFeed())
      )
      // set price of dai to 0
      await chainlinkFeed.updateAnswer(0)
      await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())
      await setOraclePrice(usdcAsset.address, bn('1e8'))
      await assetRegistry.refresh()
      await main.connect(owner).pauseTrading()

      const [erc20s, breakdown, targets] = await facade.callStatic.basketBreakdown(rToken.address)
      expect(erc20s.length).to.equal(4)
      expect(breakdown.length).to.equal(4)
      expect(targets.length).to.equal(4)
      expect(erc20s[0]).to.equal(token.address)
      expect(erc20s[1]).to.equal(usdc.address)
      expect(erc20s[2]).to.equal(aToken.address)
      expect(erc20s[3]).to.equal(cToken.address)
      expect(breakdown[0]).to.equal(fp('0')) // dai
      expect(breakdown[1]).to.equal(fp('1')) // usdc
      expect(breakdown[2]).to.equal(fp('0')) // adai
      expect(breakdown[3]).to.equal(fp('0')) // cdai
      expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
    })

    it('Should return basketBreakdown correctly for tokens with different oracleErrors', async () => {
      const FiatCollateralFactory = await ethers.getContractFactory('FiatCollateral')
      const largeErrDai = await FiatCollateralFactory.deploy({
        priceTimeout: await tokenAsset.priceTimeout(),
        chainlinkFeed: await tokenAsset.chainlinkFeed(),
        oracleError: ORACLE_ERROR.mul(4),
        erc20: await tokenAsset.erc20(),
        maxTradeVolume: await tokenAsset.maxTradeVolume(),
        oracleTimeout: await tokenAsset.oracleTimeout(),
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01'),
        delayUntilDefault: await tokenAsset.delayUntilDefault(),
      })
      await assetRegistry.swapRegistered(largeErrDai.address)
      await basketHandler.connect(owner).refreshBasket()
      await expectValidBasketBreakdown(rToken) // should still be 25/25/25/25 split
    })

    it('Should return totalAssetValue correctly - FacadeTest', async () => {
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should revert totalAssetValue when frozen - FacadeTest', async () => {
      await main.connect(owner).freezeShort()
      await expect(facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.revertedWith(
        'frozen'
      )
    })

    it('Should return RToken price correctly', async () => {
      const avgPrice = fp('1')
      const [lowPrice, highPrice] = await facade.price(rToken.address)
      const delta = avgPrice.mul(ORACLE_ERROR).div(fp('1'))
      const expectedLow = avgPrice.sub(delta)
      const expectedHigh = avgPrice.add(delta)
      expect(lowPrice).to.equal(expectedLow)
      expect(highPrice).to.equal(expectedHigh)
    })

    // P1 only
    if (IMPLEMENTATION == Implementation.P1) {
      let stRSRP1: StRSRP1

      beforeEach(async () => {
        stRSRP1 = await ethers.getContractAt('StRSRP1', stRSR.address)
      })

      it('Should return pending unstakings', async () => {
        // Stake
        const unstakeAmount = bn('10000e18')
        await rsr.connect(owner).mint(addr1.address, unstakeAmount.mul(20))
        await rsr.connect(addr1).approve(stRSR.address, unstakeAmount.mul(20))
        await stRSRP1.connect(addr1).stake(unstakeAmount.mul(20))

        // Bump draftEra by seizing half the RSR when the withdrawal queue is empty
        let draftEra = await stRSRP1.getDraftEra()
        expect(draftEra).to.equal(1)
        await whileImpersonating(backingManager.address, async (signer) => {
          await stRSRP1.connect(signer).seizeRSR(unstakeAmount.mul(10)) // seize half
        })
        draftEra = await stRSRP1.getDraftEra()
        expect(draftEra).to.equal(2) // era bumps because queue is empty

        await stRSRP1.connect(addr1).unstake(unstakeAmount.mul(4)) // eventually 75% StRSR/RSR depreciation

        // Bump draftEra by seizing half the RSR when the queue is empty
        await whileImpersonating(backingManager.address, async (signer) => {
          await stRSRP1.connect(signer).seizeRSR(unstakeAmount.mul(5)) // seize half, again
        })
        draftEra = await stRSRP1.getDraftEra()
        expect(draftEra).to.equal(2) // no era bump

        await stRSRP1.connect(addr1).unstake(unstakeAmount.mul(4).add(1)) // test rounding

        const pendings = await facade.pendingUnstakings(rToken.address, draftEra, addr1.address)
        expect(pendings.length).to.eql(2)
        expect(pendings[0][0]).to.eql(bn(0)) // index
        expect(pendings[0][2]).to.eql(unstakeAmount) // RSR amount, not draft amount

        expect(pendings[1][0]).to.eql(bn(1)) // index
        expect(pendings[1][2]).to.eql(unstakeAmount) // RSR amount, not draft amount
      })

      it('Should return prime basket', async () => {
        const [erc20s, targetNames, targetAmts] = await facade.primeBasket(rToken.address)
        expect(erc20s.length).to.equal(4)
        expect(targetNames.length).to.equal(4)
        expect(targetAmts.length).to.equal(4)
        const expectedERC20s = [token.address, usdc.address, aToken.address, cToken.address]
        for (let i = 0; i < 4; i++) {
          expect(erc20s[i]).to.equal(expectedERC20s[i])
          expect(targetNames[i]).to.equal(ethers.utils.formatBytes32String('USD'))
          expect(targetAmts[i]).to.equal(fp('0.25'))
        }
      })

      it('Should return prime basket after a default', async () => {
        // Set a backup config
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [token.address])

        // Set up DISABLED collateral (USDC)
        await setOraclePrice(usdcAsset.address, bn('0.5'))
        const delayUntiDefault = await usdcAsset.delayUntilDefault()
        const currentTimestamp = await getLatestBlockTimestamp()
        await usdcAsset.refresh()
        await setNextBlockTimestamp(currentTimestamp + delayUntiDefault + 1)
        await usdcAsset.refresh()
        expect(await usdcAsset.status()).to.equal(CollateralStatus.DISABLED)

        // switch basket, removing USDC
        await basketHandler.refreshBasket()
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

        // prime basket should still be all 4 tokens
        const [erc20s, targetNames, targetAmts] = await facade.primeBasket(rToken.address)
        expect(erc20s.length).to.equal(4)
        expect(targetNames.length).to.equal(4)
        expect(targetAmts.length).to.equal(4)
        const expectedERC20s = [token.address, usdc.address, aToken.address, cToken.address]
        for (let i = 0; i < 4; i++) {
          expect(erc20s[i]).to.equal(expectedERC20s[i])
          expect(targetNames[i]).to.equal(ethers.utils.formatBytes32String('USD'))
          expect(targetAmts[i]).to.equal(fp('0.25'))
        }
      })

      it('Should return backup config', async () => {
        // Set a backup config
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [
            token.address,
            usdc.address,
          ])

        // Expect that config
        let [erc20s, max] = await facade.backupConfig(
          rToken.address,
          ethers.utils.formatBytes32String('USD')
        )
        expect(erc20s.length).to.equal(2)
        expect(erc20s[0]).to.equal(token.address)
        expect(erc20s[1]).to.equal(usdc.address)
        expect(max).to.equal(1)

        // Expect empty config for non-USD
        ;[erc20s, max] = await facade.backupConfig(
          rToken.address,
          ethers.utils.formatBytes32String('EUR')
        )
        expect(erc20s.length).to.equal(0)
        expect(max).to.equal(0)
      })
    }
  })

  describe('FacadeMonitor', () => {
    const monitorParams: IMonitorParams = {
      AAVE_V2_DATA_PROVIDER_ADDR: ZERO_ADDRESS,
    }

    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)
    })

    it('should return batch auctions disabled correctly', async () => {
      expect(await facadeMonitor.batchAuctionsDisabled(rToken.address)).to.equal(false)

      // Disable Broker Batch Auctions
      await disableBatchTrade(broker)

      expect(await facadeMonitor.batchAuctionsDisabled(rToken.address)).to.equal(true)
    })

    it('should return dutch auctions disabled correctly', async () => {
      expect(await facadeMonitor.dutchAuctionsDisabled(rToken.address)).to.equal(false)

      // Disable Broker Dutch Auctions for token0
      await disableDutchTrade(broker, token.address)

      expect(await facadeMonitor.dutchAuctionsDisabled(rToken.address)).to.equal(true)
    })

    it('should return issuance available', async () => {
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1')) // no supply

      // Issue some RTokens (1%)
      const issueAmount = bn('10000e18')

      // Issue rTokens (1%)
      await rToken.connect(addr1).issue(issueAmount)

      // check throttles updated
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('0.99'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Issue additional rTokens (another 1%)
      await rToken.connect(addr1).issue(issueAmount)

      // Should be 2% down minus some recharging
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.be.closeTo(
        fp('0.98'),
        fp('0.001')
      )
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Advance time significantly
      await advanceTime(10000000)

      // Check new issuance available - fully recharged
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Issuance #2 - Consume all throttle
      const issueAmount2: BigNumber = config.issuanceThrottle.amtRate
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount2)

      // Check new issuance available - all consumed
      expect(await rToken.issuanceAvailable()).to.equal(bn(0))
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(bn(0))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))
    })

    it('should return redemption available', async () => {
      const issueAmount = bn('100000e18')

      // Decrease redemption allowed amount
      const redeemThrottleParams = { amtRate: issueAmount.div(2), pctRate: fp('0.1') } // 50K
      await rToken.connect(owner).setRedemptionThrottleParams(redeemThrottleParams)

      // Check with no supply
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Issue some RTokens
      await rToken.connect(addr1).issue(issueAmount)

      // check throttles - redemption still fully available
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('0.9'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Redeem RTokens (50% of throttle)
      await rToken.connect(addr1).redeem(issueAmount.div(4))

      // check throttle - redemption allowed decreased to 50%
      expect(await rToken.redemptionAvailable()).to.equal(issueAmount.div(4))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('0.5'))

      // Advance time significantly
      await advanceTime(10000000)

      //  Check redemption available - fully recharged
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Redemption #2 - Consume all throttle
      await rToken.connect(addr1).redeem(issueAmount.div(2))

      // Check new redemption available - all consumed
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(bn(0))
    })

    it('Should handle issuance/redemption throttles correctly, using percent', async function () {
      // Full issuance available. Nothing to redeem
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Issue full throttle
      const issueAmount1: BigNumber = config.issuanceThrottle.amtRate
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount1)

      // Check redemption throttles updated
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(bn(0))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Advance time significantly
      await advanceTime(1000000000)

      // Check new issuance available - fully recharged
      expect(await rToken.issuanceAvailable()).to.equal(config.issuanceThrottle.amtRate)
      expect(await rToken.redemptionAvailable()).to.equal(issueAmount1)

      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Issuance #2 - Full throttle again - will be processed
      const issueAmount2: BigNumber = config.issuanceThrottle.amtRate
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount2)

      // Check new issuance available - all consumed
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(bn(0))

      // Check redemption throttle updated - fixed in max (does not exceed)
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Set issuance throttle to percent only
      const issuanceThrottleParams = { amtRate: fp('1'), pctRate: fp('0.1') } // 10%
      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)

      // Advance time significantly
      await advanceTime(1000000000)

      // Check new issuance available - 10% of supply (2 M) = 200K
      const supplyThrottle = bn('200000e18')
      expect(await rToken.issuanceAvailable()).to.equal(supplyThrottle)
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))

      // Check redemption throttle unchanged
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Issuance #3 - Should be allowed, does not exceed supply restriction
      const issueAmount3: BigNumber = bn('100000e18')
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount3)

      // Check issuance throttle updated - Previous issuances recharged
      expect(await rToken.issuanceAvailable()).to.equal(supplyThrottle.sub(issueAmount3))

      // Hourly Limit: 210K (10% of total supply of 2.1 M)
      // Available: 100 K / 201K (~ 0.47619)
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.be.closeTo(
        fp('0.476'),
        fp('0.001')
      )

      // Check redemption throttle unchanged
      expect(await rToken.redemptionAvailable()).to.equal(config.redemptionThrottle.amtRate)
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Check all issuances are confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(
        issueAmount1.add(issueAmount2).add(issueAmount3)
      )

      // Advance time, issuance will recharge a bit
      await advanceTime(100)

      // Now 50% of hourly limit available (~105.8K / 210 K)
      expect(await rToken.issuanceAvailable()).to.be.closeTo(fp('105800'), fp('100'))
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.be.closeTo(
        fp('0.5'),
        fp('0.01')
      )
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      const issueAmount4: BigNumber = fp('105800')
      // Issuance #4 - almost all available
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 12)
      await rToken.connect(addr1).issue(issueAmount4)

      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.be.closeTo(
        fp('0.003'),
        fp('0.001')
      )
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Advance time significantly to fully recharge
      await advanceTime(1000000000)

      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Check redemptions
      // Set redemption throttle to percent only
      const redemptionThrottleParams = { amtRate: fp('1'), pctRate: fp('0.1') } // 10%
      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

      const totalSupply = await rToken.totalSupply()
      expect(await rToken.redemptionAvailable()).to.equal(totalSupply.div(10)) // 10%
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Redeem half of the available throttle
      await rToken.connect(addr1).redeem(totalSupply.div(10).div(2))

      // About 52% now used of redemption throttle
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.be.closeTo(
        fp('0.52'),
        fp('0.01')
      )

      // Advance time significantly to fully recharge
      await advanceTime(1000000000)

      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(fp('1'))

      // Redeem all remaining
      await rToken.connect(addr1).redeem(await rToken.redemptionAvailable())

      // Check all consumed
      expect(await facadeMonitor.issuanceAvailable(rToken.address)).to.equal(fp('1'))
      expect(await rToken.redemptionAvailable()).to.equal(bn(0))
      expect(await facadeMonitor.redemptionAvailable(rToken.address)).to.equal(bn(0))
    })

    it('Should not allow empty owner on initialization', async () => {
      const FacadeMonitorFactory: ContractFactory = await ethers.getContractFactory('FacadeMonitor')

      const newFacadeMonitor = <FacadeMonitor>await upgrades.deployProxy(FacadeMonitorFactory, [], {
        constructorArgs: [monitorParams],
        kind: 'uups',
      })

      await expect(newFacadeMonitor.init(ZERO_ADDRESS)).to.be.revertedWith('invalid owner address')
    })

    it('Should allow owner to transfer ownership', async () => {
      expect(await facadeMonitor.owner()).to.equal(owner.address)

      // Attempt to transfer ownership with another account
      await expect(
        facadeMonitor.connect(addr1).transferOwnership(addr1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Owner remains the same
      expect(await facadeMonitor.owner()).to.equal(owner.address)

      // Transfer ownership with owner
      await expect(facadeMonitor.connect(owner).transferOwnership(addr1.address))
        .to.emit(facadeMonitor, 'OwnershipTransferred')
        .withArgs(owner.address, addr1.address)

      // Owner changed
      expect(await facadeMonitor.owner()).to.equal(addr1.address)
    })

    it('Should only allow owner to upgrade', async () => {
      const FacadeMonitorV2Factory: ContractFactory = await ethers.getContractFactory(
        'FacadeMonitorV2'
      )
      const facadeMonitorV2 = await FacadeMonitorV2Factory.deploy(monitorParams)

      await expect(
        facadeMonitor.connect(addr1).upgradeTo(facadeMonitorV2.address)
      ).to.be.revertedWith('Ownable: caller is not the owner')
      await expect(facadeMonitor.connect(owner).upgradeTo(facadeMonitorV2.address)).to.not.be
        .reverted
    })

    it('Should upgrade correctly', async () => {
      // Upgrading
      const FacadeMonitorV2Factory: ContractFactory = await ethers.getContractFactory(
        'FacadeMonitorV2'
      )
      const facadeMonitorV2: FacadeMonitorV2 = <FacadeMonitorV2>await upgrades.upgradeProxy(
        facadeMonitor.address,
        FacadeMonitorV2Factory,
        {
          constructorArgs: [monitorParams],
        }
      )

      // Check address is maintained
      expect(facadeMonitorV2.address).to.equal(facadeMonitor.address)

      // Check state is preserved
      expect(await facadeMonitorV2.owner()).to.equal(owner.address)

      // Check new version is implemented
      expect(await facadeMonitorV2.version()).to.equal('2.0.0')

      expect(await facadeMonitorV2.newValue()).to.equal(0)
      await facadeMonitorV2.connect(owner).setNewValue(bn(1000))
      expect(await facadeMonitorV2.newValue()).to.equal(bn(1000))
    })
  })

  // P1 only
  describeP1('ActFacet on P1', () => {
    let issueAmount: BigNumber

    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cToken.connect(owner).mint(addr2.address, initialBal)

      // Mint RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Use P1 specific versions
      backingManager = <BackingManagerP1>(
        await ethers.getContractAt('BackingManagerP1', backingManager.address)
      )
      rTokenTrader = <RevenueTraderP1>(
        await ethers.getContractAt('RevenueTraderP1', rTokenTrader.address)
      )
      rsrTrader = <RevenueTraderP1>await ethers.getContractAt('RevenueTraderP1', rsrTrader.address)
    })

    it('Should claim rewards', async () => {
      const rewardAmountAAVE = bn('0.5e18')
      const rewardAmountCOMP = bn('0.8e18')

      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await compToken.balanceOf(rsrTrader.address)).to.equal(0)

      // AAVE Rewards
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)
      await aToken.setRewards(rTokenTrader.address, rewardAmountAAVE)

      // COMP Rewards
      await compoundMock.setRewards(rsrTrader.address, rewardAmountCOMP)

      // Via Facade, claim rewards from backingManager
      await expectEvents(facade.claimRewards(rToken.address), [
        {
          contract: aToken,
          name: 'RewardsClaimed',
          args: [aaveToken.address, rewardAmountAAVE],
          emitted: true,
        },
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [aaveToken.address, rewardAmountAAVE],
          emitted: true,
        },
        {
          contract: rsrTrader,
          name: 'RewardsClaimed',
          args: [compToken.address, rewardAmountCOMP],
          emitted: true,
        },
      ])

      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
      expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(rewardAmountAAVE)
      expect(await compToken.balanceOf(rsrTrader.address)).to.equal(rewardAmountCOMP)
    })

    it('Should run revenue auctions correctly', async () => {
      const auctionLength = await broker.dutchAuctionLength()
      const tokenSurplus = bn('0.5e18')
      await token.connect(addr1).transfer(rsrTrader.address, tokenSurplus)

      // Run revenue auctions
      await expect(
        facade.runRevenueAuctions(rsrTrader.address, [], [token.address], [TradeKind.DUTCH_AUCTION])
      )
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(anyValue, token.address, rsr.address, anyValue, anyValue)

      // Nothing should be settleable
      expect((await facade.auctionsSettleable(rsrTrader.address)).length).to.equal(0)

      // Advance time till auction ended
      await advanceToTimestamp((await getLatestBlockTimestamp()) + auctionLength + 13)

      // Settle and start new auction - Will retry
      await expectEvents(
        facade.runRevenueAuctions(
          rsrTrader.address,
          [token.address],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        ),
        [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, token.address, rsr.address, anyValue, anyValue],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, token.address, rsr.address, anyValue, anyValue],
            emitted: true,
          },
        ]
      )
    })

    it('Should handle other versions when running revenue auctions', async () => {
      const revTraderV2: RevenueTraderCompatibleV2 = <RevenueTraderCompatibleV2>(
        await RevenueTraderV2ImplFactory.deploy()
      )

      const revTraderV1: RevenueTraderCompatibleV1 = <RevenueTraderCompatibleV1>(
        await RevenueTraderV1ImplFactory.deploy()
      )

      const backingManagerV2: BackingMgrCompatibleV2 = <BackingMgrCompatibleV2>(
        await BackingMgrV2ImplFactory.deploy()
      )

      const backingManagerV1: BackingMgrCompatibleV1 = <BackingMgrCompatibleV1>(
        await BackingMgrV1ImplFactory.deploy()
      )

      const auctionLength = await broker.dutchAuctionLength()
      const tokenSurplus = bn('0.5e18')
      await token.connect(addr1).transfer(rTokenTrader.address, tokenSurplus)

      // Run revenue auctions
      await expect(
        facade.runRevenueAuctions(
          rTokenTrader.address,
          [],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        )
      )
        .to.emit(rTokenTrader, 'TradeStarted')
        .withArgs(anyValue, token.address, rToken.address, anyValue, anyValue)

      // Nothing should be settleable
      expect((await facade.auctionsSettleable(rTokenTrader.address)).length).to.equal(0)

      // Advance time till auction ended
      await advanceToTimestamp((await getLatestBlockTimestamp()) + auctionLength + 13)

      // Upgrade components to V2
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerV2.address)
        await rTokenTrader.connect(signer).upgradeTo(revTraderV2.address)
      })

      // Settle and start new auction - Will retry
      await expectEvents(
        facade.runRevenueAuctions(
          rTokenTrader.address,
          [token.address],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        ),
        [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, token.address, rToken.address, anyValue, anyValue],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, token.address, rToken.address, anyValue, anyValue],
            emitted: true,
          },
        ]
      )

      // Upgrade to V1
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerV1.address)
        await rTokenTrader.connect(signer).upgradeTo(revTraderV1.address)
      })

      // Advance time till auction ended
      await advanceToTimestamp((await getLatestBlockTimestamp()) + auctionLength + 13)

      // Settle and start new auction - Will retry again
      await expectEvents(
        facade.runRevenueAuctions(
          rTokenTrader.address,
          [token.address],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        ),
        [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, token.address, rToken.address, anyValue, anyValue],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, token.address, rToken.address, anyValue, anyValue],
            emitted: true,
          },
        ]
      )
    })

    it('Should handle invalid versions when running revenue auctions', async () => {
      const revTraderInvalidVer: RevenueTraderInvalidVersion = <RevenueTraderInvalidVersion>(
        await RevenueTraderInvalidVerImplFactory.deploy()
      )

      const backingManagerInvalidVer: BackingMgrInvalidVersion = <BackingMgrInvalidVersion>(
        await BackingMgrInvalidVerImplFactory.deploy()
      )

      // Upgrade RevenueTrader to invalid version - Use RSR as an example
      await whileImpersonating(main.address, async (signer) => {
        await rsrTrader.connect(signer).upgradeTo(revTraderInvalidVer.address)
      })

      const tokenSurplus = bn('0.5e18')
      await token.connect(addr1).transfer(rsrTrader.address, tokenSurplus)

      await expect(
        facade.runRevenueAuctions(rsrTrader.address, [], [token.address], [TradeKind.DUTCH_AUCTION])
      ).to.be.revertedWith('unrecognized version')

      // Also set BackingManager to invalid version
      await whileImpersonating(main.address, async (signer) => {
        await backingManager.connect(signer).upgradeTo(backingManagerInvalidVer.address)
      })

      await expect(
        facade.runRevenueAuctions(rsrTrader.address, [], [token.address], [TradeKind.DUTCH_AUCTION])
      ).to.be.revertedWith('unrecognized version')
    })
  })
})
