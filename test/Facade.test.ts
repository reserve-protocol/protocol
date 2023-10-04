import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { expectEvents } from '../common/events'
import { IConfig } from '#/common/configuration'
import { bn, fp } from '../common/numbers'
import { setOraclePrice } from './utils/oracles'
import {
  Asset,
  BackingManagerP1,
  BackingMgrCompatibleV1,
  BackingMgrCompatibleV2,
  BackingMgrInvalidVersion,
  ComptrollerMock,
  CTokenWrapperMock,
  ERC20Mock,
  FacadeAct,
  FacadeRead,
  FacadeMint,
  FacadeTest,
  MockV3Aggregator,
  RecollateralizationLibP1,
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
} from './fixtures'
import { advanceBlocks, getLatestBlockTimestamp, setNextBlockTimestamp } from './utils/time'
import { CollateralStatus, TradeKind, MAX_UINT256, ZERO_ADDRESS } from '#/common/constants'
import { expectTrade } from './utils/trades'
import { mintCollaterals } from './utils/tokens'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

const itP1 = IMPLEMENTATION == Implementation.P1 ? it : it.skip

describe('Facade contracts', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cTokenVault: CTokenWrapperMock
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
  let facadeRead: FacadeRead
  let facadeTest: FacadeTest
  let facadeAct: FacadeAct
  let facadeMint: FacadeMint

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
      facadeAct,
      facadeRead,
      facadeMint,
      facadeTest,
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
    cTokenVault = <CTokenWrapperMock>(
      await ethers.getContractAt('CTokenWrapperMock', await cTokenAsset.erc20())
    )

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

  context('FacadeMint + FacadeRead + FacadeAct', () => {
    let issueAmount: BigNumber

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
      await cTokenVault.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    describe('FacadeMint', () => {
      it('Should return maxIssuable correctly', async () => {
        // Check values
        expect(await facadeMint.callStatic.maxIssuable(rToken.address, addr1.address)).to.equal(
          bn('39999999900e18')
        )
        expect(await facadeMint.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
          bn('40000000000e18')
        )
        expect(await facadeMint.callStatic.maxIssuable(rToken.address, other.address)).to.equal(0)

        // Redeem all RTokens
        await rToken.connect(addr1).redeem(issueAmount)

        // With 0 baskets needed - Returns correct value
        expect(await facadeMint.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
          bn('40000000000e18')
        )
      })

      it('Should revert maxIssuable when frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(
          facadeMint.callStatic.maxIssuable(rToken.address, addr1.address)
        ).to.be.revertedWith('frozen')
      })

      it('Should return issuable quantities correctly', async () => {
        const [toks, quantities, uoas] = await facadeMint.callStatic.issue(
          rToken.address,
          issueAmount
        )
        expect(toks.length).to.equal(4)
        expect(toks[0]).to.equal(token.address)
        expect(toks[1]).to.equal(usdc.address)
        expect(toks[2]).to.equal(aToken.address)
        expect(toks[3]).to.equal(cTokenVault.address)
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
        await setOraclePrice(tokenAsset.address, MAX_UINT256.div(2).sub(1))
        const [toks, quantities, uoas] = await facadeMint.callStatic.issue(
          rToken.address,
          issueAmount
        )
        expect(toks.length).to.equal(4)
        expect(toks[0]).to.equal(token.address)
        expect(toks[1]).to.equal(usdc.address)
        expect(toks[2]).to.equal(aToken.address)
        expect(toks[3]).to.equal(cTokenVault.address)
        expect(quantities.length).to.equal(4)
        expect(quantities[0]).to.equal(issueAmount.div(4))
        expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
        expect(quantities[2]).to.equal(issueAmount.div(4))
        expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
        expect(uoas.length).to.equal(4)
        // Three assets are unpriced
        expect(uoas[0]).to.equal(0)
        expect(uoas[1]).to.equal(issueAmount.div(4))
        expect(uoas[2]).to.equal(0)
        expect(uoas[3]).to.equal(0)
      })

      it('Should revert when returning issuable quantities if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(facadeMint.callStatic.issue(rToken.address, issueAmount)).to.be.revertedWith(
          'frozen'
        )
      })

      it('Should return redeemable quantities correctly', async () => {
        const [toks, quantities, available] = await facadeMint.callStatic.redeem(
          rToken.address,
          issueAmount
        )
        expect(toks.length).to.equal(4)
        expect(toks[0]).to.equal(token.address)
        expect(toks[1]).to.equal(usdc.address)
        expect(toks[2]).to.equal(aToken.address)
        expect(toks[3]).to.equal(cTokenVault.address)
        expect(quantities[0]).to.equal(issueAmount.div(4))
        expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
        expect(quantities[2]).to.equal(issueAmount.div(4))
        expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
        expect(available[0]).to.equal(issueAmount.div(4))
        expect(available[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
        expect(available[2]).to.equal(issueAmount.div(4))
        expect(available[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))

        // redeemCustom
        const [toksCustom, quantitiesCustom] = await facadeMint.callStatic.redeemCustom(
          rToken.address,
          issueAmount,
          [await basketHandler.nonce()],
          [fp('1')]
        )
        expect(toksCustom.length).to.equal(4)
        expect(toksCustom[0]).to.equal(token.address)
        expect(toksCustom[1]).to.equal(usdc.address)
        expect(toksCustom[2]).to.equal(aToken.address)
        expect(toksCustom[3]).to.equal(cTokenVault.address)
        expect(quantitiesCustom[0]).to.equal(issueAmount.div(4))
        expect(quantitiesCustom[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
        expect(quantitiesCustom[2]).to.equal(issueAmount.div(4))
        expect(quantitiesCustom[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))

        // Prorata case -- burn half
        await token.burn(await main.backingManager(), issueAmount.div(8))
        const [newToks, newQuantities, newAvailable] = await facadeMint.callStatic.redeem(
          rToken.address,
          issueAmount
        )
        expect(newToks[0]).to.equal(token.address)
        expect(newQuantities[0]).to.equal(issueAmount.div(4))
        expect(newAvailable[0]).to.equal(issueAmount.div(4).div(2))

        // redeemCustom
        const [newToksCustom, newQuantitiesCustom] = await facadeMint.callStatic.redeemCustom(
          rToken.address,
          issueAmount,
          [await basketHandler.nonce()],
          [fp('1')]
        )
        expect(newToksCustom.length).to.equal(4)
        expect(newToksCustom[0]).to.equal(token.address)
        expect(newToksCustom[1]).to.equal(usdc.address)
        expect(newToksCustom[2]).to.equal(aToken.address)
        expect(newToksCustom[3]).to.equal(cTokenVault.address)
        expect(newQuantitiesCustom[0]).to.equal(issueAmount.div(4).div(2))
        expect(newQuantitiesCustom[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
        expect(newQuantitiesCustom[2]).to.equal(issueAmount.div(4))
        expect(newQuantitiesCustom[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))

        // refreshBasket()
        await basketHandler.connect(owner).refreshBasket()
        await expect(facadeMint.callStatic.redeem(rToken.address, issueAmount)).not.to.be.reverted
        const [prevBasketTokens, prevBasketQuantities] = await facadeMint.callStatic.redeemCustom(
          rToken.address,
          issueAmount,
          [(await basketHandler.nonce()) - 1],
          [fp('1')]
        )
        expect(prevBasketTokens.length).to.equal(4)
        expect(prevBasketTokens[0]).to.equal(token.address)
        expect(prevBasketTokens[1]).to.equal(usdc.address)
        expect(prevBasketTokens[2]).to.equal(aToken.address)
        expect(prevBasketTokens[3]).to.equal(cTokenVault.address)
        expect(prevBasketQuantities[0]).to.equal(issueAmount.div(4).div(2))
        expect(prevBasketQuantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
        expect(prevBasketQuantities[2]).to.equal(issueAmount.div(4))
        expect(prevBasketQuantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
      })

      it('Should revert when returning redeemable quantities if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(facadeMint.callStatic.redeem(rToken.address, issueAmount)).to.be.revertedWith(
          'frozen'
        )
      })

      itP1('Should calculate customRedeem portions correctly', async () => {
        // At first, custom redemption portions should be [0, 1]
        let portions = await facadeMint.callStatic.customRedemptionPortions(rToken.address)
        expect(portions.length).to.equal(2)
        expect(portions[0]).to.equal(0)
        expect(portions[1]).to.equal(fp('1'))

        // After a basket change but before rebalancing, portions should be [0, 1, 0]
        await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(anyValue, [usdc.address], [fp('1')], false)
        portions = await facadeMint.callStatic.customRedemptionPortions(rToken.address)
        expect(portions.length).to.equal(3)
        expect(portions[0]).to.equal(0)
        expect(portions[1]).to.equal(fp('1'))
        expect(portions[2]).to.equal(0)

        // After unregistering an asset, should skip over that basket and portions should be [0, 0, 1]
        await assetRegistry.connect(owner).unregister(tokenAsset.address)
        portions = await facadeMint.callStatic.customRedemptionPortions(rToken.address)
        expect(portions.length).to.equal(3)
        expect(portions[0]).to.equal(0)
        expect(portions[1]).to.equal(0)
        expect(portions[2]).to.equal(fp('1'))

        // Re-registering the asset and burning one balance should also result in [0, 0, 1]
        await assetRegistry.connect(owner).register(tokenAsset.address)
        await token.burn(backingManager.address, await token.balanceOf(backingManager.address))
        portions = await facadeMint.callStatic.customRedemptionPortions(rToken.address)
        expect(portions.length).to.equal(3)
        expect(portions[0]).to.equal(0)
        expect(portions[1]).to.equal(0)
        expect(portions[2]).to.equal(fp('1'))

        // After rebalancing is complete, portions should [0, 0, 1]
        await usdc.mint(
          backingManager.address,
          (await usdc.balanceOf(backingManager.address)).mul(3)
        )
        portions = await facadeMint.callStatic.customRedemptionPortions(rToken.address)
        expect(portions.length).to.equal(3)
        expect(portions[0]).to.equal(0)
        expect(portions[1]).to.equal(0)
        expect(portions[2]).to.equal(fp('1'))
      })
    })

    describe('FacadeRead + interactions with implementation-agnostic FacadeAct', () => {
      const expectValidBasketBreakdown = async (rToken: TestIRToken) => {
        const [erc20s, breakdown, targets] = await facadeRead.callStatic.basketBreakdown(
          rToken.address
        )
        expect(erc20s.length).to.equal(4)
        expect(breakdown.length).to.equal(4)
        expect(targets.length).to.equal(4)
        expect(erc20s[0]).to.equal(token.address)
        expect(erc20s[1]).to.equal(usdc.address)
        expect(erc20s[2]).to.equal(aToken.address)
        expect(erc20s[3]).to.equal(cTokenVault.address)
        expect(breakdown[0]).to.be.closeTo(fp('0.25'), 10)
        expect(breakdown[1]).to.be.closeTo(fp('0.25'), 10)
        expect(breakdown[2]).to.be.closeTo(fp('0.25'), 10)
        expect(breakdown[3]).to.be.closeTo(fp('0.25'), 10)
        expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
      }

      it('should return the correct stRSR address', async () => {
        expect(await facadeRead.stToken(rToken.address)).to.equal(stRSR.address)
      })

      it('Should return backingOverview correctly', async () => {
        let [backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        // Check values - Fully collateralized and no over-collateralization
        expect(backing).to.equal(fp('1'))
        expect(overCollateralization).to.equal(0)

        // Mint some RSR
        const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
        await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

        // Stake some RSR
        await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
        await stRSR.connect(addr1).stake(stakeAmount)
        ;[backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        // Check values - Fully collateralized and fully over-collateralized
        expect(backing).to.equal(fp('1'))
        expect(overCollateralization).to.be.closeTo(fp('0.5'), 10)

        // Stake more RSR
        await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
        await stRSR.connect(addr1).stake(stakeAmount)
        ;[backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        expect(backing).to.equal(fp('1'))
        expect(overCollateralization).to.equal(fp('1'))

        // Redeem all RTokens
        await rToken.connect(addr1).redeem(issueAmount)

        // Check values = 0 (no supply)
        ;[backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        // Check values - No supply, returns 0
        expect(backing).to.equal(0)
        expect(overCollateralization).to.equal(0)
      })

      it('Should return backingOverview backing correctly when undercollateralized', async () => {
        const backingManager = await main.backingManager()
        await usdc.burn(backingManager, (await usdc.balanceOf(backingManager)).div(2))
        await basketHandler.refreshBasket()
        const [backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        // Check values - Fully collateralized and no over-collateralization
        expect(backing).to.equal(fp('0.875'))
        expect(overCollateralization).to.equal(0)
      })

      it('Should return backingOverview backing correctly when an asset price is 0', async () => {
        await setOraclePrice(tokenAsset.address, bn(0))
        const [backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        // Check values - Fully collateralized and no over-collateralization
        expect(backing).to.equal(fp('1'))
        expect(overCollateralization).to.equal(0)
      })

      it('Should return backingOverview backing correctly when basket collateral is UNPRICED', async () => {
        await setOraclePrice(tokenAsset.address, MAX_UINT256.div(2).sub(1))
        await basketHandler.refreshBasket()
        const [backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
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

        const [backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

        // Check values - Fully collateralized and no over-collateralization
        expect(backing).to.equal(fp('1'))
        expect(overCollateralization).to.equal(fp('0.5'))

        // Set price to 0
        await setOraclePrice(rsrAsset.address, bn(0))

        const [backing2, overCollateralization2] = await facadeRead.callStatic.backingOverview(
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
        let [backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )
        expect(backing).to.equal(fp('1'))
        expect(overCollateralization).to.equal(fp('0.5'))

        await setOraclePrice(rsrAsset.address, MAX_UINT256.div(2).sub(1))
        ;[backing, overCollateralization] = await facadeRead.callStatic.backingOverview(
          rToken.address
        )

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
        await cTokenVault.connect(addr1).transfer(rTokenTrader.address, 1)
        await cTokenVault.connect(addr1).transfer(rsrTrader.address, 2)

        // Balances
        const [erc20s, balances, balancesNeededByBackingManager] =
          await facadeRead.callStatic.balancesAcrossAllTraders(rToken.address)
        expect(erc20s.length).to.equal(8)
        expect(balances.length).to.equal(8)
        expect(balancesNeededByBackingManager.length).to.equal(8)

        for (let i = 0; i < 8; i++) {
          let bal = bn('0')
          if (erc20s[i] == token.address) bal = issueAmount.div(4)
          if (erc20s[i] == usdc.address) bal = issueAmount.div(4).div(bn('1e12'))
          if (erc20s[i] == aToken.address) bal = issueAmount.div(4)
          if (erc20s[i] == cTokenVault.address) bal = issueAmount.div(4).mul(50).div(bn('1e10'))

          if (
            [token.address, usdc.address, aToken.address, cTokenVault.address].indexOf(erc20s[i]) >=
            0
          ) {
            expect(balances[i]).to.equal(bal.add(3)) // expect 3 more
            expect(balancesNeededByBackingManager[i]).to.equal(bal)
          } else {
            expect(balances[i]).to.equal(0)
            expect(balancesNeededByBackingManager[i]).to.equal(0)
          }
        }
      })

      it('Should return revenue + chain into FacadeAct.runRevenueAuctions', async () => {
        const traders = [rTokenTrader, rsrTrader]
        const initialPrice = await usdcAsset.price()

        // Set lotLow to 0 == revenueOverview() should not revert
        await setOraclePrice(usdcAsset.address, bn('0'))
        await usdcAsset.refresh()
        for (let traderIndex = 0; traderIndex < traders.length; traderIndex++) {
          const trader = traders[traderIndex]

          const minTradeVolume = await trader.minTradeVolume()
          const auctionLength = await broker.dutchAuctionLength()
          const tokenSurplus = bn('0.5e18')
          await token.connect(addr1).transfer(trader.address, tokenSurplus)

          const [lotLow] = await usdcAsset.lotPrice()
          expect(lotLow).to.equal(initialPrice[0])

          // revenue
          let [erc20s, canStart, surpluses, minTradeAmounts] =
            await facadeAct.callStatic.revenueOverview(trader.address)
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
            const asset = await ethers.getContractAt(
              'IAsset',
              await assetRegistry.toAsset(erc20s[i])
            )
            const [low] = await asset.lotPrice()
            expect(minTradeAmounts[i]).to.equal(
              low.gt(0) ? minTradeVolume.mul(bn('10').pow(await asset.erc20Decimals())).div(low) : 0
            ) // 1% oracleError
          }

          // Run revenue auctions via multicall
          const funcSig = ethers.utils.id('runRevenueAuctions(address,address[],address[],uint8[])')
          const args = ethers.utils.defaultAbiCoder.encode(
            ['address', 'address[]', 'address[]', 'uint8[]'],
            [trader.address, [], erc20sToStart, [TradeKind.DUTCH_AUCTION]]
          )
          const data = funcSig.substring(0, 10) + args.slice(2)
          await expect(facadeAct.multicall([data])).to.emit(trader, 'TradeStarted')

          // Another call to revenueOverview should not propose any auction
          ;[erc20s, canStart, surpluses, minTradeAmounts] =
            await facadeAct.callStatic.revenueOverview(trader.address)
          expect(canStart).to.eql(Array(8).fill(false))

          // Nothing should be settleable
          expect((await facadeRead.auctionsSettleable(trader.address)).length).to.equal(0)

          // Advance time till auction is over
          await advanceBlocks(2 + auctionLength / 12)

          // Now should be settleable
          const settleable = await facadeRead.auctionsSettleable(trader.address)
          expect(settleable.length).to.equal(1)
          expect(settleable[0]).to.equal(token.address)

          // Another call to revenueOverview should settle and propose new auction
          ;[erc20s, canStart, surpluses, minTradeAmounts] =
            await facadeAct.callStatic.revenueOverview(trader.address)

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
          await facadeAct.runRevenueAuctions(trader.address, erc20sToStart, erc20sToStart, [
            TradeKind.DUTCH_AUCTION,
          ])

          // Send additional revenues
          await token.connect(addr1).transfer(trader.address, tokenSurplus)

          // Call revenueOverview, cannot open new auctions
          ;[erc20s, canStart, surpluses, minTradeAmounts] =
            await facadeAct.callStatic.revenueOverview(trader.address)
          expect(canStart).to.eql(Array(8).fill(false))
        }
      })

      itP1('Should handle invalid versions when running revenueOverview', async () => {
        // Use P1 specific versions
        rsrTrader = <RevenueTraderP1>(
          await ethers.getContractAt('RevenueTraderP1', rsrTrader.address)
        )
        backingManager = <BackingManagerP1>(
          await ethers.getContractAt('BackingManagerP1', backingManager.address)
        )

        const bckMgrInvalidVer: BackingMgrInvalidVersion = <BackingMgrInvalidVersion>(
          await BackingMgrInvalidVerImplFactory.deploy()
        )

        await expect(facadeAct.callStatic.revenueOverview(rsrTrader.address)).not.to.be.reverted
        await backingManager.connect(owner).upgradeTo(bckMgrInvalidVer.address)

        // Reverts due to invalid version when forwarding revenue
        await expect(facadeAct.callStatic.revenueOverview(rsrTrader.address)).to.be.revertedWith(
          'unrecognized version'
        )
      })

      it('Should return nextRecollateralizationAuction', async () => {
        // Confirm no auction to run yet - should not revert
        let [canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        ;[canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        ;[canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        ;[canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        await backingManager.connect(owner).upgradeTo(backingManagerV2.address)

        // Confirm no auction to run yet - should not revert
        let [canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        ;[canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        await backingManager.connect(owner).upgradeTo(backingManagerV1.address)

        // nextRecollateralizationAuction should return false (trade open)
        ;[canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
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
        ;[canStart, sell, buy, sellAmount] =
          await facadeAct.callStatic.nextRecollateralizationAuction(
            backingManager.address,
            TradeKind.BATCH_AUCTION
          )
        expect(canStart).to.equal(true)
        expect(sell).to.equal(token.address)
        expect(buy).to.equal(usdc.address)
        expect(sellAmount).to.equal(sellAmt)

        // Invalid versions are also handled
        await backingManager.connect(owner).upgradeTo(backingManagerInvalidVer.address)

        await expect(
          facadeAct.callStatic.nextRecollateralizationAuction(
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
        await backingManager.connect(owner).upgradeTo(backingManagerInvalidVer.address)

        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, [usdc.address], [fp('1')], false)

        // Attempt to trigger recollateralization
        await expect(
          facadeAct.callStatic.nextRecollateralizationAuction(
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
        await main.connect(owner).pauseTrading()
        const [erc20s, breakdown, targets] = await facadeRead.callStatic.basketBreakdown(
          rToken.address
        )
        expect(erc20s.length).to.equal(4)
        expect(breakdown.length).to.equal(4)
        expect(targets.length).to.equal(4)
        expect(erc20s[0]).to.equal(token.address)
        expect(erc20s[1]).to.equal(usdc.address)
        expect(erc20s[2]).to.equal(aToken.address)
        expect(erc20s[3]).to.equal(cTokenVault.address)
        expect(breakdown[0]).to.equal(fp('0')) // dai
        expect(breakdown[1]).to.equal(fp('1')) // usdc
        expect(breakdown[2]).to.equal(fp('0')) // adai
        expect(breakdown[3]).to.equal(fp('0')) // cdai
        expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
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
        const [lowPrice, highPrice] = await facadeRead.price(rToken.address)
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
          const unstakeAmount = bn('10000e18')
          await rsr.connect(owner).mint(addr1.address, unstakeAmount.mul(10))

          // Stake
          await rsr.connect(addr1).approve(stRSR.address, unstakeAmount.mul(10))
          await stRSRP1.connect(addr1).stake(unstakeAmount.mul(10))
          await stRSRP1.connect(addr1).unstake(unstakeAmount)
          await stRSRP1.connect(addr1).unstake(unstakeAmount.add(1))

          const pendings = await facadeRead.pendingUnstakings(rToken.address, addr1.address)
          expect(pendings.length).to.eql(2)
          expect(pendings[0][0]).to.eql(bn(0)) // index
          expect(pendings[0][2]).to.eql(unstakeAmount) // amount

          expect(pendings[1][0]).to.eql(bn(1)) // index
          expect(pendings[1][2]).to.eql(unstakeAmount.add(1)) // amount
        })

        it('Should return prime basket', async () => {
          const [erc20s, targetNames, targetAmts] = await facadeRead.primeBasket(rToken.address)
          expect(erc20s.length).to.equal(4)
          expect(targetNames.length).to.equal(4)
          expect(targetAmts.length).to.equal(4)
          const expectedERC20s = [token.address, usdc.address, aToken.address, cTokenVault.address]
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
          const [erc20s, targetNames, targetAmts] = await facadeRead.primeBasket(rToken.address)
          expect(erc20s.length).to.equal(4)
          expect(targetNames.length).to.equal(4)
          expect(targetAmts.length).to.equal(4)
          const expectedERC20s = [token.address, usdc.address, aToken.address, cTokenVault.address]
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
          let [erc20s, max] = await facadeRead.backupConfig(
            rToken.address,
            ethers.utils.formatBytes32String('USD')
          )
          expect(erc20s.length).to.equal(2)
          expect(erc20s[0]).to.equal(token.address)
          expect(erc20s[1]).to.equal(usdc.address)
          expect(max).to.equal(1)

          // Expect empty config for non-USD
          ;[erc20s, max] = await facadeRead.backupConfig(
            rToken.address,
            ethers.utils.formatBytes32String('EUR')
          )
          expect(erc20s.length).to.equal(0)
          expect(max).to.equal(0)
        })
      }
    })
  })

  // P1 only
  describeP1('FacadeAct', () => {
    let issueAmount: BigNumber

    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cTokenVault.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cTokenVault.connect(owner).mint(addr2.address, initialBal)

      // Mint RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cTokenVault.connect(addr1).approve(rToken.address, initialBal)

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
      await expectEvents(facadeAct.claimRewards(rToken.address), [
        {
          contract: aToken,
          name: 'RewardsClaimed',
          args: [aaveToken.address, rewardAmountAAVE],
          emitted: true,
        },
        {
          contract: aToken,
          name: 'RewardsClaimed',
          args: [aaveToken.address, rewardAmountAAVE],
          emitted: true,
        },
        {
          contract: cTokenVault,
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
        facadeAct.runRevenueAuctions(
          rsrTrader.address,
          [],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        )
      )
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(anyValue, token.address, rsr.address, anyValue, anyValue)

      // Nothing should be settleable
      expect((await facadeRead.auctionsSettleable(rsrTrader.address)).length).to.equal(0)

      // Advance time till auction ended
      await advanceBlocks(2 + auctionLength / 12)

      // Settleable now
      expect((await facadeRead.auctionsSettleable(rsrTrader.address)).length).to.equal(1)

      // Settle and start new auction - Will retry
      await expectEvents(
        facadeAct.runRevenueAuctions(
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

      // Nothing should be settleable
      expect((await facadeRead.auctionsSettleable(rsrTrader.address)).length).to.equal(0)

      // Advance time till auction ended
      await advanceBlocks(2 + auctionLength / 12)

      // Settleable now
      expect((await facadeRead.auctionsSettleable(rsrTrader.address)).length).to.equal(1)

      // Should not revert, even when not starting new auctions
      await facadeAct.runRevenueAuctions(rsrTrader.address, [token.address], [], [])
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
        facadeAct.runRevenueAuctions(
          rTokenTrader.address,
          [],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        )
      )
        .to.emit(rTokenTrader, 'TradeStarted')
        .withArgs(anyValue, token.address, rToken.address, anyValue, anyValue)

      // Nothing should be settleable
      expect((await facadeRead.auctionsSettleable(rTokenTrader.address)).length).to.equal(0)

      // Advance time till auction ended
      await advanceBlocks(1 + auctionLength / 12)

      // Upgrade components to V2
      await backingManager.connect(owner).upgradeTo(backingManagerV2.address)
      await rTokenTrader.connect(owner).upgradeTo(revTraderV2.address)

      // Settle and start new auction - Will retry
      await expectEvents(
        facadeAct.runRevenueAuctions(
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
      await backingManager.connect(owner).upgradeTo(backingManagerV1.address)
      await rTokenTrader.connect(owner).upgradeTo(revTraderV1.address)

      // Advance time till auction ended
      await advanceBlocks(1 + auctionLength / 12)

      // Settle and start new auction - Will retry again
      await expectEvents(
        facadeAct.runRevenueAuctions(
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
      await rsrTrader.connect(owner).upgradeTo(revTraderInvalidVer.address)

      const tokenSurplus = bn('0.5e18')
      await token.connect(addr1).transfer(rsrTrader.address, tokenSurplus)

      await expect(
        facadeAct.runRevenueAuctions(
          rsrTrader.address,
          [],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        )
      ).to.be.revertedWith('unrecognized version')

      // Also set BackingManager to invalid version
      await backingManager.connect(owner).upgradeTo(backingManagerInvalidVer.address)

      await expect(
        facadeAct.runRevenueAuctions(
          rsrTrader.address,
          [],
          [token.address],
          [TradeKind.DUTCH_AUCTION]
        )
      ).to.be.revertedWith('unrecognized version')
    })
  })
})
