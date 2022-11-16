import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { fp, near } from '../../common/numbers'

import * as sc from '../../typechain' // All smart contract types

import { addr } from './common'
import { SHORT_FREEZER } from '../../common/constants'

const user = (i: number) => addr((i + 1) * 0x10000)
const ConAt = ethers.getContractAt
const F = ethers.getContractFactory
const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6

// { gasLimit: 0x1ffffffff }

const componentsOfP0 = async (main: sc.IMainFuzz) => ({
  rsr: await ConAt('ERC20Fuzz', await main.rsr()),
  rToken: await ConAt('RTokenP0Fuzz', await main.rToken()),
  stRSR: await ConAt('StRSRP0Fuzz', await main.stRSR()),
  assetRegistry: await ConAt('AssetRegistryP0Fuzz', await main.assetRegistry()),
  basketHandler: await ConAt('BasketHandlerP0Fuzz', await main.basketHandler()),
  backingManager: await ConAt('BackingManagerP0Fuzz', await main.backingManager()),
  distributor: await ConAt('DistributorP0Fuzz', await main.distributor()),
  rsrTrader: await ConAt('RevenueTraderP0Fuzz', await main.rsrTrader()),
  rTokenTrader: await ConAt('RevenueTraderP0Fuzz', await main.rTokenTrader()),
  furnace: await ConAt('FurnaceP0Fuzz', await main.furnace()),
  broker: await ConAt('BrokerP0Fuzz', await main.broker()),
})
type ComponentsP0 = Awaited<ReturnType<typeof componentsOfP0>>

const componentsOfP1 = async (main: sc.IMainFuzz) => ({
  rsr: await ConAt('ERC20Fuzz', await main.rsr()),
  rToken: await ConAt('RTokenP1Fuzz', await main.rToken()),
  stRSR: await ConAt('StRSRP1Fuzz', await main.stRSR()),
  assetRegistry: await ConAt('AssetRegistryP1Fuzz', await main.assetRegistry()),
  basketHandler: await ConAt('BasketHandlerP1Fuzz', await main.basketHandler()),
  backingManager: await ConAt('BackingManagerP1Fuzz', await main.backingManager()),
  distributor: await ConAt('DistributorP1Fuzz', await main.distributor()),
  rsrTrader: await ConAt('RevenueTraderP1Fuzz', await main.rsrTrader()),
  rTokenTrader: await ConAt('RevenueTraderP1Fuzz', await main.rTokenTrader()),
  furnace: await ConAt('FurnaceP1Fuzz', await main.furnace()),
  broker: await ConAt('BrokerP1Fuzz', await main.broker()),
})
type ComponentsP1 = Awaited<ReturnType<typeof componentsOfP1>>

describe('The Differential Testing scenario', () => {
  let scenario: sc.DiffTestScenario

  let p0: sc.MainP0Fuzz
  let comp0: ComponentsP0
  let p1: sc.MainP1Fuzz
  let comp1: ComponentsP1

  let startState: Awaited<ReturnType<typeof helpers.takeSnapshot>>

  let _owner: Wallet
  let alice: Signer
  let _bob: Signer
  let _carol: Signer

  let aliceAddr: string
  let bobAddr: string
  let _carolAddr: string

  before('deploy and setup', async () => {
    ;[_owner] = (await ethers.getSigners()) as unknown as Wallet[]
    scenario = await (await F('DiffTestScenario')).deploy({ gasLimit: 0x1ffffffff })

    p0 = await ConAt('MainP0Fuzz', await scenario.p(0))
    comp0 = await componentsOfP0(p0)

    p1 = await ConAt('MainP1Fuzz', await scenario.p(1))
    comp1 = await componentsOfP1(p1)

    aliceAddr = user(0)
    bobAddr = user(1)
    _carolAddr = user(2)

    alice = await ethers.getSigner(aliceAddr)
    _bob = await ethers.getSigner(bobAddr)
    _carol = await ethers.getSigner(_carolAddr)

    await helpers.setBalance(aliceAddr, exa * exa)
    await helpers.setBalance(bobAddr, exa * exa)
    await helpers.setBalance(_carolAddr, exa * exa)
    await helpers.setBalance(p0.address, exa * exa)
    await helpers.setBalance(p1.address, exa * exa)

    await helpers.impersonateAccount(aliceAddr)
    await helpers.impersonateAccount(bobAddr)
    await helpers.impersonateAccount(_carolAddr)
    await helpers.impersonateAccount(p0.address)
    await helpers.impersonateAccount(p1.address)

    startState = await helpers.takeSnapshot()
  })

  after('stop impersonations', async () => {
    await helpers.stopImpersonatingAccount(aliceAddr)
    await helpers.stopImpersonatingAccount(bobAddr)
    await helpers.stopImpersonatingAccount(_carolAddr)
    await helpers.stopImpersonatingAccount(p0.address)
    await helpers.stopImpersonatingAccount(p1.address)
  })

  beforeEach(async () => {
    await startState.restore()
  })

  it('deploys as expected', async () => {
    for (const main of [p0, p1]) {
      // users
      expect(await main.numUsers()).to.equal(3)
      expect(await main.users(0)).to.equal(user(0))
      expect(await main.users(1)).to.equal(user(1))
      expect(await main.users(2)).to.equal(user(2))

      // auth state
      expect(await main.frozen()).to.equal(false)
      expect(await main.pausedOrFrozen()).to.equal(false)

      // tokens and user balances
      const syms = ['C0', 'C1', 'C2', 'R0', 'R1', 'USD0', 'USD1', 'USD2']
      expect(await main.numTokens()).to.equal(syms.length)
      for (const sym of syms) {
        const tokenAddr = await main.tokenBySymbol(sym)
        const token = await ConAt('ERC20Fuzz', tokenAddr)
        expect(await token.symbol()).to.equal(sym)
        for (let u = 0; u < 3; u++) {
          expect(await token.balanceOf(user(u))).to.equal(fp(1e6))
        }
      }
    }
  })

  describe('mutators', () => {
    it('issuance and redemption', async () => {
      await scenario.connect(alice).issue(5n * exa)
      expect(await comp0.rToken.balanceOf(aliceAddr)).to.equal(5n * exa)
      expect(await comp1.rToken.balanceOf(aliceAddr)).to.equal(5n * exa)

      await scenario.connect(alice).redeem(2n * exa)
      expect(await comp0.rToken.balanceOf(aliceAddr)).to.equal(3n * exa)
      expect(await comp1.rToken.balanceOf(aliceAddr)).to.equal(3n * exa)

      await expect(scenario.connect(alice).redeem(6n * exa)).to.be.reverted
    })

    it('grantRole and revokeRole work as expected', async () => {
      expect(await p0.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)
      expect(await p1.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)

      await scenario.grantRole(1, 1)
      expect(await p0.hasRole(SHORT_FREEZER, bobAddr)).to.equal(true)
      expect(await p1.hasRole(SHORT_FREEZER, bobAddr)).to.equal(true)

      await scenario.revokeRole(1, 1)
      expect(await p0.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)
      expect(await p1.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)
    })

    it('push/pop BackingForPrimeBasket works as expected', async () => {
      await expect(scenario.backingForPrimeBasket(0)).to.be.reverted
      await expect(scenario.targetAmtsForPrimeBasket(0)).to.be.reverted

      await scenario.pushBackingForPrimeBasket(1, exa - 1n)
      expect(await scenario.backingForPrimeBasket(0)).to.equal(1)
      expect(await scenario.targetAmtsForPrimeBasket(0)).to.equal(exa)

      await scenario.popBackingForPrimeBasket()
      await expect(scenario.backingForPrimeBasket(0)).to.be.reverted
      await expect(scenario.targetAmtsForPrimeBasket(0)).to.be.reverted
    })
    it('push/pop BackingForBackup works as expected', async () => {
      await expect(scenario.backingForBackup(0)).to.be.reverted

      await scenario.pushBackingForBackup(1)
      expect(await scenario.backingForBackup(0)).to.equal(1)

      await scenario.popBackingForBackup()
      await expect(scenario.backingForBackup(0)).to.be.reverted
    })

    it('{push,pop}PriceModel work as expected', async () => {
      // starts empty
      await expect(scenario.priceModels(0)).to.be.reverted
      expect(await scenario.priceModelIndex()).to.equal(0)

      // push a few
      await scenario.pushPriceModel(0, exa, exa, exa)
      await scenario.pushPriceModel(1, exa, exa, exa)
      await scenario.pushPriceModel(2, exa, exa, exa)

      expect((await scenario.priceModels(0)).kind).to.equal(0)
      expect((await scenario.priceModels(1)).kind).to.equal(1)
      expect((await scenario.priceModels(2)).kind).to.equal(2)
      await expect(scenario.priceModels(3)).to.be.reverted

      // pop all
      await scenario.popPriceModel()
      await scenario.popPriceModel()
      await scenario.popPriceModel()

      // is empty
      await expect(scenario.priceModels(0)).to.be.reverted
    })
    it('createToken, createColl, and createRewardAsset work as expected', async () => {
      const targetName = ethers.utils.formatBytes32String('Tgt')
      const gloTokID = await p0.numTokens()
      expect(await p0.numTokens()).to.equal(await p1.numTokens())

      // token = createToken
      await scenario.createToken(targetName, 'Glob', 'GLO')
      expect(await p0.numTokens()).to.equal(gloTokID.add(1))
      expect(await p0.numTokens()).to.equal(await p1.numTokens())

      const p0Token = await ConAt('IERC20Metadata', await p0.tokens(gloTokID))
      const p1Token = await ConAt('IERC20Metadata', await p1.tokens(gloTokID))

      expect(await p0Token.name()).to.equal('GlobTgt ' + gloTokID.toString())
      expect(await p1Token.name()).to.equal('GlobTgt ' + gloTokID.toString())
      expect(await p0Token.symbol()).to.equal('GLOTgt' + gloTokID.toString())
      expect(await p1Token.symbol()).to.equal('GLOTgt' + gloTokID.toString())

      // reward = createRewardAsset
      const rewardTokID = await p0.numTokens()
      await scenario.createRewardAsset(targetName)
      const p0RewardToken = await ConAt('IERC20Metadata', await p0.tokens(rewardTokID))
      expect(await p0RewardToken.name()).to.equal('RewardTgt ' + rewardTokID.toString())
      expect(await p0RewardToken.symbol()).to.equal('RTgt' + rewardTokID.toString())
      const p0RewardAsset = await ConAt(
        'AssetMock',
        await comp0.assetRegistry.toAsset(p0RewardToken.address)
      )
      expect(await p0RewardAsset.erc20()).to.equal(p0RewardToken.address)
      expect(await p0RewardAsset.isCollateral()).to.equal(false)

      const p1RewardToken = await ConAt('IERC20Metadata', await p1.tokens(rewardTokID))
      expect(await p1RewardToken.name()).to.equal('RewardTgt ' + rewardTokID.toString())
      expect(await p1RewardToken.symbol()).to.equal('RTgt' + rewardTokID.toString())
      const p1RewardAsset = await ConAt(
        'AssetMock',
        await comp1.assetRegistry.toAsset(p1RewardToken.address)
      )
      expect(await p1RewardAsset.erc20()).to.equal(p1RewardToken.address)
      expect(await p1RewardAsset.isCollateral()).to.equal(false)

      // coll = createColl(token, reward)
      await scenario.createColl(p0Token.address, p0RewardToken.address, true, exa, exa, targetName)
      const newColl = await ConAt('CollateralMock', await scenario.lastCreatedColl())
      expect(await newColl.isCollateral()).to.equal(true)
    })

    it('registerAsset works as expected', async () => {
      // OK, the "choice Seed" thing is obviously insance, but getting random configuration in
      // through fuzzing would be even worse. Digit by digit, 310000 means:
      // 3: use reward token with token index 3
      // 1: use target name with index 1
      // 0: do set a reward
      // 0: do configure as Collateral, not Asset
      // 0: do configure the Collateral as a stable+ token
      // 0: create a new token, don't actually use the token given at input.
      const initNumTokens0 = await p0.numTokens()
      const initNumTokens1 = await p1.numTokens()
      expect(initNumTokens0).to.equal(initNumTokens1)

      await scenario.registerAsset(0, exa, exa, 310000n)

      expect(await p0.numTokens()).to.equal(initNumTokens0.add(1))
      expect(await p1.numTokens()).to.equal(initNumTokens1.add(1))

      for (const main of [p0, p1]) {
        const tokID = (await main.numTokens()).sub(1)
        const tok = await main.tokens(tokID)
        const rewardTok = await main.tokens(3)

        const comp = main == p0 ? comp0 : comp1
        const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(tok))

        expect(await coll.isCollateral()).to.be.true
        expect(await coll.erc20()).to.equal(tok)
        expect(await coll.rewardERC20()).to.equal(rewardTok)
        expect(await coll.targetName()).to.equal(await scenario.targetNames(1))
      }
    })
    it('swapRegisteredAsset works as expected', async () => {
      // pretty much the same as above...
      // 3: use reward token with token index 3
      // 1: use target name with index 1
      // 0: do set a reward
      // 0: do configure as Collateral, not Asset
      // 0: do configure the Collateral as a stable+ token
      const initNumTokens0 = await p0.numTokens()
      const initNumTokens1 = await p1.numTokens()
      expect(initNumTokens0).to.equal(initNumTokens1)

      // swap out registeredAsset 7 so that it's an Asset, rather than a Collateral,
      // so we can check that things (targetName + isCollateral) have changed
      await scenario.swapRegisteredAsset(7, exa, exa, 31000n)
      expect(await p0.numTokens()).to.equal(initNumTokens0)
      expect(await p1.numTokens()).to.equal(initNumTokens1)

      for (const main of [p0, p1]) {
        const tok = await main.tokens(7) // from first parameter to swapRegisteredAsset
        const rewardTok = await main.tokens(3)

        const comp = main == p0 ? comp0 : comp1
        const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(tok))

        expect(await coll.isCollateral()).to.be.true
        expect(await coll.erc20()).to.equal(tok)
        expect(await coll.rewardERC20()).to.equal(rewardTok)
        expect(await coll.targetName()).to.equal(await scenario.someTargetName(1))
      }
    })
    it('basketHandler equality does not fail immediately', async () => {
      expect(await scenario.callStatic.echidna_bhEqualThunks()).to.be.true
      expect(await scenario.callStatic.echidna_bhEqualPrices()).to.be.true
      expect(await scenario.callStatic.echidna_bhEqualQty()).to.be.true
      expect(await scenario.callStatic.echidna_bhEqualBasketsHeld()).to.be.true
      expect(await scenario.callStatic.echidna_bhEqualQuotes()).to.be.true
      expect(await scenario.callStatic.echidna_distributorEqual()).to.be.true
      expect(await scenario.callStatic.echidna_brokerDisabledEqual()).to.be.true
    })

    it('regression test: asset error', async () => {
      await scenario.unregisterAsset(0)
      await expect(p0.poke()).not.to.be.reverted
      const numTokens = await (await p0.numTokens()).toNumber()
      for (let i = 0; i < numTokens + 3; i++) {
        const tokenAddr = await p0.someToken(i)
        const sym = await (await ConAt('IERC20Metadata', tokenAddr)).symbol()
        if (await comp0.assetRegistry.isRegistered(tokenAddr)) {
          const asset = await ConAt('IAsset', await comp0.assetRegistry.toAsset(tokenAddr))
          const priceVal = await asset.price(true)

          if (!priceVal.isFallback) {
            const priceBVal = await asset.price(false)
            expect(priceBVal[1]).to.equal(priceVal[1])
          }
        }
      }

      expect(await scenario.callStatic.echidna_assetsEquivalent()).to.be.true
    })

    it('regression test: updatePrice failure', async () => {
      await scenario.updatePrice(
        0,
        0,
        359231878025571n,
        337680369927843182947551945778576176638523057871n,
        13903n
      )

      await p0.poke()
      await p1.poke()

      const numTokens = await (await p0.numTokens()).toNumber()
      for (let i = 0; i < numTokens + 2; i++) {
        const t0Addr = await p0.someToken(i)
        const t0 = await ConAt('IERC20Metadata', t0Addr)
        const t1Addr = await p1.someToken(i)
        const asset0 = await ConAt('IAsset', await comp0.assetRegistry.toAsset(t0Addr))
        const asset1 = await ConAt('IAsset', await comp1.assetRegistry.toAsset(t1Addr))

        expect(await asset0.strictPrice()).to.equal(await asset1.strictPrice())
        const price0 = await asset0.price(true)
        const price1 = await asset1.price(true)
        expect(price0.isFallback).to.equal(price1.isFallback)
        expect(near(price0[1], price1[1], 1e4)).to.be.true

        const price0f = await asset0.price(false)
        const price1f = await asset1.price(false)
        expect(price0f.isFallback).to.equal(price1f.isFallback)
        expect(near(price0f[1], price1f[1], 1e4)).to.be.true

        expect(price0f.isFallback).to.be.false
        expect(price0[1]).to.equal(price0f[1])

        expect(price1f.isFallback).to.be.false
        expect(price1[1]).to.equal(price1f[1])

        await expect(scenario.assetsEqualPrices(asset0.address, asset1.address)).not.to.be.reverted
      }

      const ret1t = await comp1.basketHandler.price(true)
      const ret1f = await comp1.basketHandler.price(false)

      // not fallback prices:
      expect(ret1t[0]).to.be.false
      expect(ret1f[0]).to.be.false
      expect(ret1t[1]).to.equal(ret1f[1])
    })
  })
})
