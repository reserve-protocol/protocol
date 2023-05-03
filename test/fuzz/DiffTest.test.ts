// import { expect } from 'chai'
// import { ethers } from 'hardhat'
// import { Wallet, Signer } from 'ethers'
// import * as helpers from '@nomicfoundation/hardhat-network-helpers'

// import { fp } from '../../common/numbers'

// import * as sc from '../../typechain' // All smart contract types

// import { addr } from './common'
// import { advanceTime, advanceBlocks } from '../../test/utils/time'
// import { SHORT_FREEZER } from '../../common/constants'

// const user = (i: number) => addr((i + 1) * 0x10000)
// const ConAt = ethers.getContractAt
// const F = ethers.getContractFactory
// const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6

// // { gasLimit: 0x1ffffffff }

// const componentsOfP0 = async (main: sc.IMainFuzz) => ({
//   rsr: await ConAt('ERC20Fuzz', await main.rsr()),
//   rToken: await ConAt('RTokenP0Fuzz', await main.rToken()),
//   stRSR: await ConAt('StRSRP0Fuzz', await main.stRSR()),
//   assetRegistry: await ConAt('AssetRegistryP0Fuzz', await main.assetRegistry()),
//   basketHandler: await ConAt('BasketHandlerP0Fuzz', await main.basketHandler()),
//   backingManager: await ConAt('BackingManagerP0Fuzz', await main.backingManager()),
//   distributor: await ConAt('DistributorP0Fuzz', await main.distributor()),
//   rsrTrader: await ConAt('RevenueTraderP0Fuzz', await main.rsrTrader()),
//   rTokenTrader: await ConAt('RevenueTraderP0Fuzz', await main.rTokenTrader()),
//   furnace: await ConAt('FurnaceP0Fuzz', await main.furnace()),
//   broker: await ConAt('BrokerP0Fuzz', await main.broker()),
// })
// type ComponentsP0 = Awaited<ReturnType<typeof componentsOfP0>>

// const componentsOfP1 = async (main: sc.IMainFuzz) => ({
//   rsr: await ConAt('ERC20Fuzz', await main.rsr()),
//   rToken: await ConAt('RTokenP1Fuzz', await main.rToken()),
//   stRSR: await ConAt('StRSRP1Fuzz', await main.stRSR()),
//   assetRegistry: await ConAt('AssetRegistryP1Fuzz', await main.assetRegistry()),
//   basketHandler: await ConAt('BasketHandlerP1Fuzz', await main.basketHandler()),
//   backingManager: await ConAt('BackingManagerP1Fuzz', await main.backingManager()),
//   distributor: await ConAt('DistributorP1Fuzz', await main.distributor()),
//   rsrTrader: await ConAt('RevenueTraderP1Fuzz', await main.rsrTrader()),
//   rTokenTrader: await ConAt('RevenueTraderP1Fuzz', await main.rTokenTrader()),
//   furnace: await ConAt('FurnaceP1Fuzz', await main.furnace()),
//   broker: await ConAt('BrokerP1Fuzz', await main.broker()),
// })
// type ComponentsP1 = Awaited<ReturnType<typeof componentsOfP1>>

// // deprecated 2/4/23
// describe.skip('The Differential Testing scenario', () => {
//   let scenario: sc.DiffTestScenario

//   let p0: sc.MainP0Fuzz
//   let comp0: ComponentsP0
//   let p1: sc.MainP1Fuzz
//   let comp1: ComponentsP1

//   let startState: Awaited<ReturnType<typeof helpers.takeSnapshot>>

//   let _owner: Wallet
//   let alice: Signer
//   let _bob: Signer
//   let _carol: Signer

//   let aliceAddr: string
//   let bobAddr: string
//   let _carolAddr: string

//   before('deploy and setup', async () => {
//     ;[_owner] = (await ethers.getSigners()) as unknown as Wallet[]
//     scenario = await (await F('DiffTestScenario')).deploy({ gasLimit: 0x1ffffffff })

//     p0 = await ConAt('MainP0Fuzz', await scenario.p(0))
//     comp0 = await componentsOfP0(p0)

//     p1 = await ConAt('MainP1Fuzz', await scenario.p(1))
//     comp1 = await componentsOfP1(p1)

//     aliceAddr = user(0)
//     bobAddr = user(1)
//     _carolAddr = user(2)

//     alice = await ethers.getSigner(aliceAddr)
//     _bob = await ethers.getSigner(bobAddr)
//     _carol = await ethers.getSigner(_carolAddr)

//     await helpers.setBalance(aliceAddr, exa * exa)
//     await helpers.setBalance(bobAddr, exa * exa)
//     await helpers.setBalance(_carolAddr, exa * exa)
//     await helpers.setBalance(p0.address, exa * exa)
//     await helpers.setBalance(p1.address, exa * exa)

//     await helpers.impersonateAccount(aliceAddr)
//     await helpers.impersonateAccount(bobAddr)
//     await helpers.impersonateAccount(_carolAddr)
//     await helpers.impersonateAccount(p0.address)
//     await helpers.impersonateAccount(p1.address)

//     await helpers.mine(300, { interval: 12 }) // charge battery

//     startState = await helpers.takeSnapshot()
//   })

//   after('stop impersonations', async () => {
//     await helpers.stopImpersonatingAccount(aliceAddr)
//     await helpers.stopImpersonatingAccount(bobAddr)
//     await helpers.stopImpersonatingAccount(_carolAddr)
//     await helpers.stopImpersonatingAccount(p0.address)
//     await helpers.stopImpersonatingAccount(p1.address)
//   })

//   beforeEach(async () => {
//     await startState.restore()
//   })

//   it('deploys as expected', async () => {
//     for (const main of [p0, p1]) {
//       // users
//       expect(await main.numUsers()).to.equal(3)
//       expect(await main.users(0)).to.equal(user(0))
//       expect(await main.users(1)).to.equal(user(1))
//       expect(await main.users(2)).to.equal(user(2))

//       // auth state
//       expect(await main.frozen()).to.equal(false)
//       expect(await main.pausedOrFrozen()).to.equal(false)

//       // tokens and user balances
//       const syms = ['C0', 'C1', 'C2', 'R0', 'R1', 'USD0', 'USD1', 'USD2']
//       expect(await main.numTokens()).to.equal(syms.length)
//       for (const sym of syms) {
//         const tokenAddr = await main.tokenBySymbol(sym)
//         const token = await ConAt('ERC20Fuzz', tokenAddr)
//         expect(await token.symbol()).to.equal(sym)
//         for (let u = 0; u < 3; u++) {
//           expect(await token.balanceOf(user(u))).to.equal(fp(1e6))
//         }
//       }
//     }
//   })

//   describe('mutators', () => {
//     it('issuance and redemption', async () => {
//       await scenario.connect(alice).issue(5n * exa)
//       expect(await comp0.rToken.balanceOf(aliceAddr)).to.equal(5n * exa)
//       expect(await comp1.rToken.balanceOf(aliceAddr)).to.equal(5n * exa)

//       await scenario.connect(alice).redeem(2n * exa)
//       expect(await comp0.rToken.balanceOf(aliceAddr)).to.equal(3n * exa)
//       expect(await comp1.rToken.balanceOf(aliceAddr)).to.equal(3n * exa)

//       await expect(scenario.connect(alice).redeem(6n * exa)).to.be.reverted
//     })

//     it('grantRole and revokeRole work as expected', async () => {
//       expect(await p0.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)
//       expect(await p1.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)

//       await scenario.grantRole(1, 1)
//       expect(await p0.hasRole(SHORT_FREEZER, bobAddr)).to.equal(true)
//       expect(await p1.hasRole(SHORT_FREEZER, bobAddr)).to.equal(true)

//       await scenario.revokeRole(1, 1)
//       expect(await p0.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)
//       expect(await p1.hasRole(SHORT_FREEZER, bobAddr)).to.equal(false)
//     })

//     it('push/pop BackingForPrimeBasket works as expected', async () => {
//       await expect(scenario.backingForPrimeBasket(0)).to.be.reverted
//       await expect(scenario.targetAmtsForPrimeBasket(0)).to.be.reverted

//       await scenario.pushBackingForPrimeBasket(1, exa - 1n)
//       expect(await scenario.backingForPrimeBasket(0)).to.equal(1)
//       expect(await scenario.targetAmtsForPrimeBasket(0)).to.equal(exa)

//       await scenario.popBackingForPrimeBasket()
//       await expect(scenario.backingForPrimeBasket(0)).to.be.reverted
//       await expect(scenario.targetAmtsForPrimeBasket(0)).to.be.reverted
//     })
//     it('push/pop BackingForBackup works as expected', async () => {
//       await expect(scenario.backingForBackup(0)).to.be.reverted

//       await scenario.pushBackingForBackup(1)
//       expect(await scenario.backingForBackup(0)).to.equal(1)

//       await scenario.popBackingForBackup()
//       await expect(scenario.backingForBackup(0)).to.be.reverted
//     })

//     it('{push,pop}PriceModel work as expected', async () => {
//       // starts empty
//       await expect(scenario.priceModels(0)).to.be.reverted
//       expect(await scenario.priceModelIndex()).to.equal(0)

//       // push a few
//       await scenario.pushPriceModel(0, exa, exa, exa)
//       await scenario.pushPriceModel(1, exa, exa, exa)
//       await scenario.pushPriceModel(2, exa, exa, exa)

//       expect((await scenario.priceModels(0)).kind).to.equal(0)
//       expect((await scenario.priceModels(1)).kind).to.equal(1)
//       expect((await scenario.priceModels(2)).kind).to.equal(2)
//       await expect(scenario.priceModels(3)).to.be.reverted

//       // pop all
//       await scenario.popPriceModel()
//       await scenario.popPriceModel()
//       await scenario.popPriceModel()

//       // is empty
//       await expect(scenario.priceModels(0)).to.be.reverted
//     })
//     it('createToken works as expected', async () => {
//       const targetName = ethers.utils.formatBytes32String('Tgt')
//       const gloTokID = await p0.numTokens()
//       expect(await p0.numTokens()).to.equal(await p1.numTokens())

//       // token = createToken
//       await scenario.createToken(targetName, 'Glob', 'GLO')
//       expect(await p0.numTokens()).to.equal(gloTokID.add(1))
//       expect(await p0.numTokens()).to.equal(await p1.numTokens())

//       const p0Token = await ConAt('IERC20Metadata', await p0.tokens(gloTokID))
//       const p1Token = await ConAt('IERC20Metadata', await p1.tokens(gloTokID))

//       expect(await p0Token.name()).to.equal('GlobTgt ' + gloTokID.toString())
//       expect(await p1Token.name()).to.equal('GlobTgt ' + gloTokID.toString())
//       expect(await p0Token.symbol()).to.equal('GLOTgt' + gloTokID.toString())
//       expect(await p1Token.symbol()).to.equal('GLOTgt' + gloTokID.toString())
//     })

//     it('registerAsset works as expected', async () => {
//       const initNumTokens0 = await p0.numTokens()
//       const initNumTokens1 = await p1.numTokens()
//       expect(initNumTokens0).to.equal(initNumTokens1)

//       await scenario.createToken(ethers.utils.formatBytes32String('Tgt'), 'Fnord', 'K')
//       await scenario.registerAsset(initNumTokens0, 1, exa, 2n ** 47n, true, true)

//       expect(await p0.numTokens()).to.equal(initNumTokens0.add(1))
//       expect(await p1.numTokens()).to.equal(initNumTokens1.add(1))

//       for (const main of [p0, p1]) {
//         const tokID = (await main.numTokens()).sub(1)
//         const tok = await main.tokens(tokID)

//         const comp = main == p0 ? comp0 : comp1
//         const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(tok))

//         expect(await coll.isCollateral()).to.be.true
//         expect(await coll.erc20()).to.equal(tok)
//         expect(await coll.targetName()).to.equal(await scenario.targetNames(1))
//       }
//     })
//     it('swapRegisteredAsset works as expected', async () => {
//       const initNumTokens0 = await p0.numTokens()
//       const initNumTokens1 = await p1.numTokens()
//       expect(initNumTokens0).to.equal(initNumTokens1)

//       await scenario.createToken(ethers.utils.formatBytes32String('Tgt'), 'Fnord', 'K')
//       await scenario.registerAsset(initNumTokens0, 1, exa, 2n ** 47n, true, true)

//       // swap out registeredAsset 7 so that it's an Asset, rather than a Collateral,
//       // so we can check that things (targetName + isCollateral) have changed
//       await scenario.swapRegisteredAsset(initNumTokens0, 1, exa, 2n ** 47n, true, true)
//       expect(await p0.numTokens()).to.equal(initNumTokens0.add(1))
//       expect(await p1.numTokens()).to.equal(initNumTokens1.add(1))

//       for (const main of [p0, p1]) {
//         const tok = await main.tokens(initNumTokens0) // from first parameter to swapRegisteredAsset

//         const comp = main == p0 ? comp0 : comp1
//         const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(tok))

//         expect(await coll.isCollateral()).to.be.true
//         expect(await coll.erc20()).to.equal(tok)
//         expect(await coll.targetName()).to.equal(await scenario.someTargetName(1))
//       }
//     })
//     it('basketHandler equality does not fail immediately', async () => {
//       expect(await scenario.callStatic.echidna_bhEqualThunks()).to.be.true
//       expect(await scenario.callStatic.echidna_bhEqualPrices()).to.be.true
//       expect(await scenario.callStatic.echidna_bhEqualQty()).to.be.true
//       expect(await scenario.callStatic.echidna_bhEqualBasketsHeld()).to.be.true
//       expect(await scenario.callStatic.echidna_bhEqualQuotes()).to.be.true
//       expect(await scenario.callStatic.echidna_distributorEqual()).to.be.true
//       expect(await scenario.callStatic.echidna_brokerDisabledEqual()).to.be.true
//     })
//   })

//   describe('does not contain the bug in which', () => {
//     /* Notes for reproductions:
//        In this scenario, someToken arguments are (by default) %'d by 11
//     */
//     it('claimRewards breaks sync after one block', async () => {
//       await advanceBlocks(10)
//       await advanceTime(120)
//       await scenario.connect(alice).claimRewards(0)
//       expect(await scenario.callStatic.echidna_assetsEquivalent()).to.be.true
//     })
//     it('setErrorState and then claimRewards breaks assetsEquivalent', async () => {
//       await scenario.setErrorState(0, true, true)
//       await scenario.claimRewards(0)
//       expect(await scenario.callStatic.echidna_assetsEquivalent()).to.be.true
//     })
//     it('pausing breaks sync', async () => {
//       await scenario.grantRole(3, 0)
//       await scenario.connect(alice).pause()
//       expect(await scenario.callStatic.echidna_distributorEqual()).to.be.true
//     })
//     it('assetRegistry.refresh() was called from stake(), but only in P0, 1 day ago', async () => {
//       await scenario.setErrorState(0, false, true)
//       await scenario.connect(alice).stake(1)
//       await advanceTime(86400)
//       expect(await scenario.callStatic.echidna_bhEqualThunks()).to.be.true
//     })
//     it('assetsEqualPrices was not wise to rtokenAsset.lotPrice() failing', async () => {
//       await scenario.connect(alice).issueTo(1, 2)
//       await scenario.unregisterAsset(0)
//       expect(await scenario.callStatic.echidna_assetsEquivalent()).to.be.true
//     })
//   })
// })
