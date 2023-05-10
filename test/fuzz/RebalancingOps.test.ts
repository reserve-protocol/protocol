import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer, BigNumber } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { fp, bn } from '../../common/numbers'
import { whileImpersonating } from '../utils/impersonation'
import { CollateralStatus, RoundingMode, TradeStatus } from '../../common/constants'
import { advanceTime, advanceBlocks } from '../utils/time'

import * as sc from '../../typechain' // All smart contract types

import { addr, PriceModelKind, RebalancingScenarioStatus } from './common'

const user = (i: number) => addr((i + 1) * 0x10000)
const ConAt = ethers.getContractAt
const F = ethers.getContractFactory
const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6

// { gasLimit: 0x1ffffffff }

const componentsOf = async (main: sc.IMainFuzz) => ({
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
type Components = Awaited<ReturnType<typeof componentsOf>>

describe('The Rebalancing scenario', () => {
  let scenario: sc.RebalancingScenario
  let main: sc.MainP1Fuzz
  let comp: Components
  let startState: Awaited<ReturnType<typeof helpers.takeSnapshot>>

  let owner: Wallet
  let alice: Signer
  let bob: Signer
  let carol: Signer

  let aliceAddr: string
  let bobAddr: string
  let carolAddr: string

  // addrIDs: maps addresses to their address IDs. Inverse of main.someAddr.
  // for any addr the system tracks, main.someAddr(addrIDs(addr)) == addr
  let addrIDs: Map<string, number>

  // tokenIDs: maps token symbols to their token IDs.
  // for any token symbol in the system, main.someToken(tokenIDs(symbol)).symbol() == symbol
  let tokenIDs: Map<string, number>

  let warmupPeriod: number

  const warmup = async () => {
    await advanceTime(warmupPeriod)
    await advanceBlocks(warmupPeriod / 12)
  }

  before('deploy and setup', async () => {
    ;[owner] = (await ethers.getSigners()) as unknown as Wallet[]
    scenario = await (await F('RebalancingScenario')).deploy({ gasLimit: 0x1ffffffff })
    main = await ConAt('MainP1Fuzz', await scenario.main())
    comp = await componentsOf(main)

    addrIDs = new Map()
    let i = 0
    while (true) {
      const address = await main.someAddr(i)
      if (addrIDs.has(address)) break
      addrIDs.set(address, i)
      i++
    }

    tokenIDs = new Map()
    i = 0
    while (true) {
      const tokenAddr = await main.someToken(i)
      const token = await ConAt('ERC20Fuzz', tokenAddr)
      const symbol = await token.symbol()
      if (tokenIDs.has(symbol)) break
      tokenIDs.set(symbol, i)
      i++
    }

    alice = await ethers.getSigner(await main.users(0))
    bob = await ethers.getSigner(await main.users(1))
    carol = await ethers.getSigner(await main.users(2))

    aliceAddr = await alice.getAddress()
    bobAddr = await bob.getAddress()
    carolAddr = await carol.getAddress()

    await helpers.setBalance(aliceAddr, exa * exa)
    await helpers.setBalance(bobAddr, exa * exa)
    await helpers.setBalance(carolAddr, exa * exa)
    await helpers.setBalance(main.address, exa * exa)

    await helpers.impersonateAccount(aliceAddr)
    await helpers.impersonateAccount(bobAddr)
    await helpers.impersonateAccount(carolAddr)
    await helpers.impersonateAccount(main.address)

    await helpers.mine(300, { interval: 12 }) // charge battery

    warmupPeriod = await comp.basketHandler.warmupPeriod()

    startState = await helpers.takeSnapshot()
  })

  after('stop impersonations', async () => {
    await helpers.stopImpersonatingAccount(aliceAddr)
    await helpers.stopImpersonatingAccount(bobAddr)
    await helpers.stopImpersonatingAccount(carolAddr)
    await helpers.stopImpersonatingAccount(main.address)
  })

  beforeEach(async () => {
    await startState.restore()
  })
  it('deploys as expected', async () => {
    // users
    expect(await main.numUsers()).to.equal(3)
    expect(await main.users(0)).to.equal(user(0))
    expect(await main.users(1)).to.equal(user(1))
    expect(await main.users(2)).to.equal(user(2))

    // auth state
    expect(await main.frozen()).to.equal(false)
    expect(await main.tradingPausedOrFrozen()).to.equal(false)
    expect(await main.issuancePausedOrFrozen()).to.equal(false)

    // tokens and user balances
    const syms = [
      'CA0',
      'CA1',
      'CA2',
      'RA0',
      'RA1',
      'SA0',
      'SA1',
      'SA2',
      'CB0',
      'CB1',
      'CB2',
      'RB0',
      'RB1',
      'SB0',
      'SB1',
      'SB2',
      'CC0',
      'CC1',
      'CC2',
      'RC0',
      'RC1',
      'SC0',
      'SC1',
      'SC2',
    ]
    expect(await main.numTokens()).to.equal(syms.length)
    for (const sym of syms) {
      const tokenAddr = await main.tokenBySymbol(sym)
      const token = await ConAt('ERC20Fuzz', tokenAddr)
      expect(await token.symbol()).to.equal(sym)
      for (let u = 0; u < 3; u++) {
        expect(await token.balanceOf(user(u))).to.equal(fp(1e6))
      }
    }

    // assets and collateral
    const erc20s = await comp.assetRegistry.erc20s()
    expect(erc20s.length).to.equal(syms.length + 2) // RSR and RToken
    for (const erc20 of erc20s) {
      await comp.assetRegistry.toAsset(erc20)
    }

    // relations between components and their addresses
    expect(await comp.assetRegistry.isRegistered(comp.rsr.address)).to.be.true
    expect(await comp.assetRegistry.isRegistered(comp.rToken.address)).to.be.true
    expect(await comp.rToken.main()).to.equal(main.address)
    expect(await comp.stRSR.main()).to.equal(main.address)
    expect(await comp.assetRegistry.main()).to.equal(main.address)
    expect(await comp.basketHandler.main()).to.equal(main.address)
    expect(await comp.backingManager.main()).to.equal(main.address)
    expect(await comp.distributor.main()).to.equal(main.address)
    expect(await comp.rsrTrader.main()).to.equal(main.address)
    expect(await comp.rTokenTrader.main()).to.equal(main.address)
    expect(await comp.furnace.main()).to.equal(main.address)
    expect(await comp.broker.main()).to.equal(main.address)
  })
  describe('has mutators that', () => {
    it('can refresh assets', async () => {
      const numTokens = await main.numTokens()

      // Check all collateral is sound - update prices - some should be marked IFFY or DISABLED
      for (let i = 0; numTokens.gt(i); i++) {
        const token = await main.someToken(i)

        const asset = await ConAt('IAsset', await comp.assetRegistry.toAsset(token))
        const isCollateral: boolean = await asset.isCollateral()

        if (isCollateral) {
          const coll = await ConAt('CollateralMock', asset.address)
          expect(await coll.status()).to.equal(CollateralStatus.SOUND)

          // Update price (force depeg)
          await scenario.updatePrice(i, 0, 0, exa, exa)
        }
      }

      // Refresh assets
      await scenario.refreshAssets()

      // Check CA1, CB1, and CC1 are IFFY
      // Check CA2, CB2, and CC2 are DISABLED
      for (let i = 0; numTokens.gt(i); i++) {
        const token = await main.someToken(i)
        const erc20 = await ConAt('ERC20Fuzz', token)
        const asset = await ConAt('IAsset', await comp.assetRegistry.toAsset(token))
        const isCollateral: boolean = await asset.isCollateral()

        if (isCollateral) {
          const coll = await ConAt('CollateralMock', asset.address)
          const sym = await erc20.symbol()
          if (['CA1', 'CB1', 'CC1'].indexOf(sym) > -1) {
            expect(await coll.status()).to.equal(CollateralStatus.IFFY)
          } else if (['CA2', 'CB2', 'CC2'].indexOf(sym) > -1) {
            expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
          } else {
            expect(await coll.status()).to.equal(CollateralStatus.SOUND)
          }
        }
      }
    })

    it('can register/unregister/swap assets', async () => {
      // assets and collateral
      const erc20s = await comp.assetRegistry.erc20s()
      expect(erc20s.length).to.equal(26) // includes RSR and RToken

      // Unregister a collateral from backup config - SA2
      await scenario.unregisterAsset(7)

      let updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(25)

      // Create additional reward token
      await scenario.createToken(2, 'Fnord', 'FFF')

      // Register collateral again for target A
      await scenario.registerAsset(7, 0, exa, 2n ** 47n, true, false, 0)

      updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(26)

      // Swap collateral in main basket - CA2 - for same type
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))
      const currentColl = await ConAt(
        'CollateralMock',
        await comp.assetRegistry.toColl(token.address)
      )

      await scenario.swapRegisteredAsset(4, 0, exa, 2n ** 47n, true, true, 0)

      const newColl = await ConAt('CollateralMock', await comp.assetRegistry.toColl(token.address))

      expect(currentColl.address).to.not.equal(newColl.address)
      expect(await currentColl.erc20()).to.equal(await newColl.erc20())
    })

    it('can create stable+ collateral with reward', async () => {
      expect((await comp.assetRegistry.erc20s()).length).to.equal(26)

      // Unregister a collateral from backup config - SA2
      await scenario.unregisterAsset(7)
      expect((await comp.assetRegistry.erc20s()).length).to.equal(25)

      // Register STABLE collateral for target A
      await scenario.registerAsset(7, 0, exa, 2n ** 47n, true, true, 0)
      expect((await comp.assetRegistry.erc20s()).length).to.equal(26)

      // Check collateral values
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('SA2'))
      const newColl = await ConAt('CollateralMock', await comp.assetRegistry.toColl(token.address))

      const [low, high] = await newColl.price()
      expect(low.add(high).div(2)).equal(fp(1))

      expect(await newColl.refPerTok()).equal(fp(1))
      expect(await newColl.targetPerRef()).equal(fp(1))
    })

    it('can create random collateral with new token and reward', async () => {
      let updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(26)

      // Push some price models, by default uses STABLE Price Model
      // Note: Will use STABLE for the remaining price models
      await scenario.pushPriceModel(3, fp('1'), fp('1'), fp('1.5')) // for ref per tok in collateral- Walk
      await scenario.pushPriceModel(1, fp('2'), fp('2'), fp('2')) // for target per ref in collateral- Manual
      await scenario.pushPriceModel(2, fp('1'), fp('0.9'), fp('1.1')) // stable for uoa per target
      await scenario.pushPriceModel(2, fp('1'), fp('0.9'), fp('1.1')) // stable for deviation

      // Register a new RANDOM collateral from a new token
      const tokenID = await main.numTokens()
      await scenario.createToken(0, 'Fnord', 'fr')
      await scenario.registerAsset(tokenID, 0, exa, 2n ** 47n, true, false, 0)

      // Check 1 new tokens registered
      updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(27)

      // Check collateral values - RANDOM
      const newToken = await ConAt('ERC20Fuzz', await main.tokens(tokenID))
      const newRandomColl = await ConAt(
        'CollateralMock',
        await comp.assetRegistry.toColl(newToken.address)
      )

      const [low, high] = await newRandomColl.price()
      expect(low.add(high).div(2)).equal(fp(2))
      expect(await newRandomColl.refPerTok()).to.equal(fp(1))
      expect(await newRandomColl.targetPerRef()).to.equal(fp(2))
    })

    it('can set prime basket and refresh', async () => {
      // Check current basket
      const [tokenAddrs] = await comp.basketHandler.quote(1n * exa, RoundingMode.CEIL)

      expect(tokenAddrs.length).to.equal(9)

      const token0 = await ConAt('ERC20Fuzz', tokenAddrs[0])
      const token1 = await ConAt('ERC20Fuzz', tokenAddrs[1])
      const token2 = await ConAt('ERC20Fuzz', tokenAddrs[2])
      const token3 = await ConAt('ERC20Fuzz', tokenAddrs[3])
      const token4 = await ConAt('ERC20Fuzz', tokenAddrs[4])
      const token5 = await ConAt('ERC20Fuzz', tokenAddrs[5])
      const token6 = await ConAt('ERC20Fuzz', tokenAddrs[6])
      const token7 = await ConAt('ERC20Fuzz', tokenAddrs[7])
      const token8 = await ConAt('ERC20Fuzz', tokenAddrs[8])

      const expectedSyms = ['CA0', 'CA1', 'CA2', 'CB0', 'CB1', 'CB2', 'CC0', 'CC1', 'CC2']
      expect(await token0.symbol()).to.equal(expectedSyms[0])
      expect(await token1.symbol()).to.equal(expectedSyms[1])
      expect(await token2.symbol()).to.equal(expectedSyms[2])
      expect(await token3.symbol()).to.equal(expectedSyms[3])
      expect(await token4.symbol()).to.equal(expectedSyms[4])
      expect(await token5.symbol()).to.equal(expectedSyms[5])
      expect(await token6.symbol()).to.equal(expectedSyms[6])
      expect(await token7.symbol()).to.equal(expectedSyms[7])
      expect(await token8.symbol()).to.equal(expectedSyms[8])

      // Update backing for prime basket
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('1').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('SA1') as number, fp('2').sub(1))

      // Remove the last one added
      await scenario.popBackingForPrimeBasket()

      await scenario.setPrimeBasket()

      // Refresh basket to be able to see updated config
      await comp.basketHandler.savePrev()
      await scenario.refreshBasket()

      const [newTokenAddrs, amts] = await comp.basketHandler.quote(1n * exa, RoundingMode.CEIL)
      expect(await comp.basketHandler.prevEqualsCurr()).to.be.false
      expect(newTokenAddrs.length).to.equal(1)

      const tokenInBasket = await ConAt('ERC20Fuzz', newTokenAddrs[0])
      expect(await tokenInBasket.symbol()).to.equal('CA1')
      // 1/1,000,000% revenue hiding
      expect(amts[0]).to.closeTo(fp('1.000001'), fp('0.0000001'))
    })

    it('can set backup basket and refresh', async () => {
      // Update backing for Backup basket - Both from target A (0)
      await scenario.pushBackingForBackup(tokenIDs.get('SA2') as number)
      await scenario.pushBackingForBackup(tokenIDs.get('SA1') as number)

      await scenario.pushBackingForBackup(tokenIDs.get('SB2') as number)
      await scenario.pushBackingForBackup(tokenIDs.get('SC2') as number)

      // Remove the last one added for Targer A ('SA1')
      await scenario.popBackingForBackup(0)

      // Set backup config for each target type - Just SA2, SB2, SC2
      await scenario.setBackupConfig(0)
      await scenario.setBackupConfig(1)
      await scenario.setBackupConfig(2)

      // Default token and refresh basket
      await comp.basketHandler.savePrev()

      // Default one token in prime basket of targets A, B, C
      await scenario.updatePrice(0, 0, fp(1), fp(1), fp(1))
      await scenario.updatePrice(2, 0, fp(1), fp(1), fp(1))
      await scenario.updatePrice(4, 0, fp(1), fp(1), fp(1)) // Will default CA2
      await scenario.updatePrice(12, 0, fp(1), fp(1), fp(1)) // Will default CB2
      await scenario.updatePrice(20, 0, fp(1), fp(1), fp(1)) // Will default CC2

      await scenario.refreshBasket()

      // Check new basket
      const [newTokenAddrs, amts] = await comp.basketHandler.quote(1n * exa, RoundingMode.CEIL)
      expect(await comp.basketHandler.prevEqualsCurr()).to.be.false
      expect(newTokenAddrs.length).to.equal(9)

      const token0 = await ConAt('ERC20Fuzz', newTokenAddrs[0])
      const token1 = await ConAt('ERC20Fuzz', newTokenAddrs[1])
      const token2 = await ConAt('ERC20Fuzz', newTokenAddrs[2])
      const token3 = await ConAt('ERC20Fuzz', newTokenAddrs[3])
      const token4 = await ConAt('ERC20Fuzz', newTokenAddrs[4])
      const token5 = await ConAt('ERC20Fuzz', newTokenAddrs[5])
      const token6 = await ConAt('ERC20Fuzz', newTokenAddrs[6])
      const token7 = await ConAt('ERC20Fuzz', newTokenAddrs[7])
      const token8 = await ConAt('ERC20Fuzz', newTokenAddrs[8])

      // CA2 was replaced by SA2
      const expectedSyms = ['CA0', 'CA1', 'CB0', 'CB1', 'CC0', 'CC1', 'SA2', 'SB2', 'SC2']
      expect(await token0.symbol()).to.equal(expectedSyms[0])
      expect(await token1.symbol()).to.equal(expectedSyms[1])
      expect(await token2.symbol()).to.equal(expectedSyms[2])
      expect(await token3.symbol()).to.equal(expectedSyms[3])
      expect(await token4.symbol()).to.equal(expectedSyms[4])
      expect(await token5.symbol()).to.equal(expectedSyms[5])
      expect(await token6.symbol()).to.equal(expectedSyms[6])
      expect(await token7.symbol()).to.equal(expectedSyms[7])
      expect(await token8.symbol()).to.equal(expectedSyms[8])

      // Check correct weights assigned for new added tokens
      // 1/1,000,000% revenue hiding
      expect(amts[6]).to.eq(fp('0.1'))
      expect(amts[7]).to.eq(fp('0.1'))
      expect(amts[8]).to.eq(fp('0.1'))
    })

    it('can handle freezing/pausing with roles', async () => {
      await warmup()
      // Check initial status
      expect(await main.tradingPaused()).to.equal(false)
      expect(await main.issuancePaused()).to.equal(false)
      expect(await main.frozen()).to.equal(false)

      //================= Pause Trading =================
      // Attempt to pause and freeze with non-approved user
      await expect(scenario.connect(alice).pauseTrading()).to.be.reverted
      await expect(scenario.connect(bob).pauseTrading()).to.be.reverted
      await expect(scenario.connect(carol).pauseTrading()).to.be.reverted

      // Grant role PAUSER (3) to Alice
      await scenario.grantRole(3, 0)
      await scenario.connect(alice).pauseTrading()

      // Check status
      expect(await main.tradingPaused()).to.equal(true)

      // Unpause and revoke role
      await scenario.connect(alice).unpauseTrading()
      await scenario.revokeRole(3, 0)

      expect(await main.tradingPaused()).to.equal(false)

      //================= Pause Issuance =================
      // Attempt to pause and freeze with non-approved user
      await expect(scenario.connect(alice).pauseIssuance()).to.be.reverted
      await expect(scenario.connect(bob).pauseIssuance()).to.be.reverted
      await expect(scenario.connect(carol).pauseIssuance()).to.be.reverted

      // Grant role PAUSER (3) to Alice
      await scenario.grantRole(3, 0)
      await scenario.connect(alice).pauseIssuance()

      // Check status
      expect(await main.issuancePaused()).to.equal(true)

      // Unpause and revoke role
      await scenario.connect(alice).unpauseIssuance()
      await scenario.revokeRole(3, 0)

      expect(await main.issuancePaused()).to.equal(false)

      // ==========  SHORT FREEZE  =================
      expect(await main.frozen()).to.equal(false)

      // Attempt to freeze will fail
      await expect(scenario.connect(alice).freezeShort()).to.be.reverted
      await expect(scenario.connect(bob).freezeShort()).to.be.reverted
      await expect(scenario.connect(carol).freezeShort()).to.be.reverted

      // Grant role SHORT FREEZER (1) to Bob
      await scenario.grantRole(1, 1)
      await scenario.connect(bob).freezeShort()
      await scenario.revokeRole(1, 1)

      // Check status
      expect(await main.frozen()).to.equal(true)

      // Only owner can unfreeze - Call with Carol as owner
      await scenario.grantRole(0, 2)
      await scenario.connect(carol).unfreeze()
      await scenario.revokeRole(0, 2)

      expect(await main.frozen()).to.equal(false)

      // ==========  LONG FREEZE  =================
      // Attempt to freeze will fail
      await expect(scenario.connect(alice).freezeLong()).to.be.reverted
      await expect(scenario.connect(bob).freezeLong()).to.be.reverted
      await expect(scenario.connect(carol).freezeLong()).to.be.reverted

      // Grant role LONG FREEZER (2) to Carol
      await scenario.grantRole(2, 2)
      await scenario.connect(carol).freezeLong()
      await scenario.revokeRole(2, 2)

      // Check status
      expect(await main.frozen()).to.equal(true)

      // Only owner can unfreeze - Call with bob as owner
      await scenario.grantRole(0, 1)
      await scenario.connect(bob).unfreeze()
      await scenario.revokeRole(0, 1)
      expect(await main.frozen()).to.equal(false)

      // ==========  FREZE FOREVER  =================
      // Attempt to freeze will fail
      await expect(scenario.connect(alice).freezeForever()).to.be.reverted
      await expect(scenario.connect(bob).freezeForever()).to.be.reverted
      await expect(scenario.connect(carol).freezeForever()).to.be.reverted

      // Grant role OWNER (0) to Alice
      await scenario.grantRole(0, 0)
      await scenario.connect(alice).freezeForever()
      // Check status
      expect(await main.frozen()).to.equal(true)

      // Only owner can unfreeze
      await scenario.connect(alice).unfreeze()
      await scenario.revokeRole(0, 0)
      expect(await main.frozen()).to.equal(false)
    })

    it('can create Price Models', async () => {
      await scenario.pushPriceModel(0, fp('1'), fp('0.95'), fp('1.5'))
      await scenario.pushPriceModel(1, fp('1000'), fp('1'), fp('1'))
      await scenario.pushPriceModel(2, fp('500000'), fp('500000'), fp('50000'))
      await scenario.pushPriceModel(3, fp('0.5'), fp('0'), fp('0.8'))

      // Check created price models
      const p0 = await scenario.priceModels(0)
      expect(p0.kind).to.equal(PriceModelKind.CONSTANT)
      expect(p0.curr).to.equal(fp('1'))
      expect(p0.low).to.equal(fp('0.95'))
      expect(p0.high).to.equal(p0.curr.add(fp('1.5')))

      const p1 = await scenario.priceModels(1)
      expect(p1.kind).to.equal(PriceModelKind.MANUAL)
      expect(p1.curr).to.equal(fp('1000'))
      expect(p1.low).to.equal(fp('1'))
      expect(p1.high).to.equal(p1.curr.add(fp('1')))

      const p2 = await scenario.priceModels(2)
      expect(p2.kind).to.equal(PriceModelKind.BAND)
      expect(p2.curr).to.equal(fp('500000'))
      expect(p2.low).to.equal(fp('500000'))
      expect(p2.high).to.equal(p2.curr.add(fp('50000')))

      const p3 = await scenario.priceModels(3)
      expect(p3.kind).to.equal(PriceModelKind.WALK)
      expect(p3.curr).to.equal(fp('0.5'))
      expect(p3.low).to.equal(0)
      expect(p3.high).to.equal(p3.curr.add(fp('0.8')))
    })

    it('can perform a recollateralization', async () => {
      await warmup()
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

      // Setup backup
      await scenario.pushBackingForBackup(tokenIDs.get('CA0') as number)
      await scenario.setBackupConfig(0)

      // Setup a simple basket of two tokens, only target type A
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.5').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.5').sub(1))
      await scenario.setPrimeBasket()

      // Switch basket
      await scenario.refreshBasket()

      // Issue some RTokens
      // As Alice, make allowances
      const [tokenAddrs, amts] = await comp.rToken.quote(15000n * exa, RoundingMode.CEIL)
      for (let i = 0; i < amts.length; i++) {
        const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
        await token.connect(alice).approve(comp.rToken.address, amts[i])
      }
      // Issue RTokens
      await scenario.connect(alice).justIssue(15000n * exa)

      // No c0 tokens in backing manager
      expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

      // Stake RSR
      await scenario.connect(alice).stake(100000n * exa)

      // Default one token in the basket CA2
      const defaultTokenId = Number(tokenIDs.get('CA2'))
      const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(c2.address))
      expect(await coll.status()).to.equal(CollateralStatus.SOUND)
      expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)

      await scenario.updatePrice(defaultTokenId, 0, fp(1), fp(1), fp(1)) // Will default CA2

      // Call main poke to perform refresh on assets
      await scenario.poke()

      // Collateral defaulted
      expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
      expect(await comp.basketHandler.fullyCollateralized()).to.equal(false)

      // Trying to manage tokens will fail due to unsound basket
      await scenario.pushBackingToManage(2)
      await scenario.pushBackingToManage(4)
      // BATCH_AUCTION
      await expect(scenario.rebalance(1)).to.be.reverted

      // Refresh basket - will perform basket switch - New basket: CA1 and CA0
      await scenario.refreshBasket()

      // Manage backing tokens, will create auction
      await warmup()
      await scenario.rebalance(1) // BATCH_AUCTION

      // Check trade
      const tradeInBackingManager = await ConAt(
        'GnosisTradeMock',
        await comp.backingManager.trades(c2.address)
      )
      const tradeInBroker = await ConAt('GnosisTradeMock', await comp.broker.lastOpenedTrade())
      expect(tradeInBackingManager.address).to.equal(tradeInBroker.address)

      expect(await tradeInBackingManager.status()).to.equal(TradeStatus.OPEN)
      expect(await tradeInBackingManager.canSettle()).to.be.false

      // All defaulted tokens moved to trader
      expect(await c2.balanceOf(comp.backingManager.address)).to.equal(0)
      expect(await c2.balanceOf(tradeInBackingManager.address)).to.be.gt(0)

      // Wait and settle the trade
      await advanceTime(await comp.broker.batchAuctionLength())
      expect(await tradeInBackingManager.canSettle()).to.be.true

      // No C0 tokens in backing manager
      expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

      // Settle trades - set some seed > 0
      await scenario.pushSeedForTrades(fp(1000000))
      await scenario.settleTrades()

      expect(await tradeInBackingManager.status()).to.equal(TradeStatus.CLOSED)

      // Check balances after
      expect(await c2.balanceOf(tradeInBackingManager.address)).to.equal(0)
      expect(await c0.balanceOf(comp.backingManager.address)).to.be.gt(0)
    })
  })

  it('has only initially-true properties', async () => {
    expect(await scenario.callStatic.echidna_quoteProportionalWhenFullyCollateralized()).to.be.true
    expect(await scenario.echidna_RTokenRateNeverFallInNormalOps()).to.be.true
    expect(await scenario.echidna_mainInvariants()).to.be.true
    expect(await scenario.echidna_assetRegistryInvariants()).to.be.true
    expect(await scenario.echidna_backingManagerInvariants()).to.be.true
    expect(await scenario.echidna_basketInvariants()).to.be.true
    expect(await scenario.echidna_brokerInvariants()).to.be.true
    expect(await scenario.echidna_distributorInvariants()).to.be.true
    expect(await scenario.echidna_furnaceInvariants()).to.be.true
    expect(await scenario.echidna_rsrTraderInvariants()).to.be.true
    expect(await scenario.echidna_rTokenTraderInvariants()).to.be.true
    expect(await scenario.echidna_rTokenInvariants()).to.be.true
    expect(await scenario.echidna_stRSRInvariants()).to.be.true
    expect(await scenario.callStatic.echidna_refreshBasketIsNoopDuringAfterRebalancing()).to.be.true
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.be.true
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.be.true
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.be.true
    expect(await scenario.echidna_isFullyCollateralizedAfterRebalancing()).to.be.true
  })

  it('does not fail on refreshBasket after just one call to updatePrice', async () => {
    await scenario.updatePrice(0, 0, 0, 0, 0)

    // emulate echidna_refreshBasketIsNoop, since it's not a view and we need its value
    await comp.basketHandler.savePrev()
    await whileImpersonating(scenario.address, async (asOwner) => {
      await comp.basketHandler.connect(asOwner).refreshBasket()
    })
    expect(await comp.basketHandler.prevEqualsCurr()).to.be.true
  })

  it('maintains basket invariants after refresh', async () => {
    await scenario.unregisterAsset(8)
    await scenario.setBackupConfig(0)
    await scenario.unregisterAsset(0)
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.equal(true)
    expect(await comp.basketHandler.isValidBasketAfterRefresh()).to.be.true
    expect(await comp.basketHandler.status()).to.equal(CollateralStatus.DISABLED)
  })

  it('maintains stRSR invariants after seizing RSR', async () => {
    await scenario.connect(alice).stake(4)
    await scenario.seizeRSR(1)
    expect(await scenario.echidna_stRSRInvariants()).to.be.true
  })

  it('maintains RToken invariants after calling issue', async () => {
    await warmup()
    // As Alice, make allowances
    const [tokenAddrs, amts] = await comp.rToken.quote(20000n * exa, RoundingMode.CEIL)
    for (let i = 0; i < amts.length; i++) {
      const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
      await token.connect(alice).approve(comp.rToken.address, amts[i])
    }
    // Issue RTokens and succeed
    await scenario.connect(alice).justIssue(20000n * exa)

    expect(await scenario.echidna_rTokenInvariants()).to.be.true
  })

  it('does not have the backingManager double-revenue bug', async () => {
    await warmup()
    // Have some RToken in existance
    await scenario.connect(alice).issue(1e6)

    // cause C0 to grow against its ref unit
    await scenario.updatePrice(0, fp(1.1), 0, 0, fp(1))

    // call manageTokens([C0, C0])
    await scenario.pushBackingToManage(0)
    await scenario.pushBackingToManage(0)
    await expect(scenario.forwardRevenue()).to.be.reverted
  })

  it('can manage scenario states - basket switch - covered by RSR', async () => {
    await warmup()
    await scenario.setIssuanceThrottleParamsDirect({amtRate: fp('30000'), pctRate: fp('0.5')})
    // Scenario starts in BEFORE_REBALANCING
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Set a simple basket
    const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
    const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

    // Setup a simple basket of two tokens, only target type A
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.5').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.5').sub(1))
    await scenario.setPrimeBasket()

    // Switch basket
    await scenario.refreshBasket()

    // Status remains - still fully collateralized as no RTokens were issued
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Issue some RTokens
    // As Alice, make allowances
    const [tokenAddrs, amts] = await comp.rToken.quote(30000n * exa, RoundingMode.CEIL)
    for (let i = 0; i < amts.length; i++) {
      const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
      await token.connect(alice).approve(comp.rToken.address, amts[i])
    }
    // Issue RTokens
    await scenario.connect(alice).justIssue(30000n * exa)

    // No c0 tokens in backing manager
    expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

    // Stake large amount of RSR
    await scenario.connect(alice).stake(100000n * exa)

    // Perform another basket switch - CA0 enters for CA2
    await scenario.popBackingForPrimeBasket()
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA0') as number, fp('0.5').sub(1))
    await scenario.setPrimeBasket()

    // We are still in initial state
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Cannot save basket range - Properties hold
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

    // ======== Begin rebalancing ========
    // Refresh basket - will perform basket switch - New basket: CA1 and CA0
    await scenario.refreshBasket()

    // Rebalancing has started
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)

    // Cannot perform a basket switch or change basket configs at this point
    await expect(scenario.popBackingForPrimeBasket()).to.be.revertedWith(
      'Not valid for current state'
    )
    await expect(
      scenario.pushBackingForPrimeBasket(tokenIDs.get('CB0') as number, fp('0.5').sub(1))
    ).to.be.revertedWith('Not valid for current state')
    await expect(scenario.setPrimeBasket()).to.be.revertedWith('Not valid for current state')

    await expect(scenario.pushBackingForBackup(tokenIDs.get('SA2') as number)).to.be.revertedWith(
      'Not valid for current state'
    )
    await expect(scenario.popBackingForBackup(0)).to.be.revertedWith('Not valid for current state')
    await expect(scenario.setBackupConfig(0)).to.be.revertedWith('Not valid for current state')

    // Does not allow to change registered assets
    await expect(scenario.pushPriceModel(0, fp('5'), 0, 0)).to.be.revertedWith(
      'Not valid for current state'
    )
    await expect(scenario.unregisterAsset(7)).to.be.revertedWith('Not valid for current state')
    await expect(scenario.registerAsset(7, 0, exa, 2n ** 47n, true, true, 0)).to.be.revertedWith(
      'Not valid for current state'
    )
    await expect(scenario.swapRegisteredAsset(4, 0, exa, 2n ** 47n, true, true, 0)).to.be.revertedWith(
      'Not valid for current state'
    )

    let iteration = 0
    while ((await scenario.status()) == RebalancingScenarioStatus.REBALANCING_ONGOING) {
      iteration++
      // We'll check the echidna properties at each step during rebalancing...
      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Manage backing tokens, will create auction
      await scenario.rebalance(1) // BATCH_AUCTION
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Check trade
      const trade = await ConAt('GnosisTradeMock', await comp.broker.lastOpenedTrade())

      expect(await comp.backingManager.tradesOpen()).to.equal(1)
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.be.false

      if (iteration == 1) {
        // The first trade is for C2 tokens.
        expect(await comp.backingManager.trades(c2.address)).to.equal(trade.address)
        // All c2 tokens have moved to trader
        expect(await c2.balanceOf(comp.backingManager.address)).to.equal(0)
        expect(await c2.balanceOf(trade.address)).to.be.gt(0)
      }
      // Wait and settle the trade
      await advanceTime(await comp.broker.batchAuctionLength())
      expect(await trade.canSettle()).to.be.true

      if (iteration == 1) {
        // No C0 tokens in backing manager
        expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

        // State remains ongoing
        expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)
      }
      // Check echidna property is true at all times in the process
      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Settle trades - set some seed > 0
      await scenario.pushSeedForTrades(fp(1000000))
      await scenario.settleTrades()

      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      expect(await trade.status()).to.equal(TradeStatus.CLOSED)
      expect(await comp.backingManager.tradesOpen()).to.equal(0)

      // Check balances after
      expect(await c2.balanceOf(trade.address)).to.equal(0)
      expect(await c0.balanceOf(comp.backingManager.address)).to.be.gt(0)
    }

    expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)

    // Property noop after rebalancing, returns true. Properties hold.
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

    // Once on this state we cannot force another rebalancing
    await expect(scenario.setPrimeBasket()).to.be.revertedWith('Not valid for current state')

    // We cam still do normal operations
    // Stake more RSR
    await scenario.connect(alice).stake(1000n * exa)

    // Can only do price updates that dont cause default
    const defaultTokenId = Number(tokenIDs.get('CA0'))
    const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(c0.address))
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)
    await scenario.updatePrice(defaultTokenId, 0, fp(1), fp(1), fp(1)) // Would default CA0

    // Call main poke to perform refresh on assets
    await scenario.poke()

    // Collateral not defaulted
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)
    expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)

    expect(await scenario.echidna_isFullyCollateralizedAfterRebalancing()).to.be.true
  })

  it('can manage scenario states - collateral default - partially covered by RSR', async () => {
    await warmup()
    await scenario.setIssuanceThrottleParamsDirect({amtRate: fp('400000'), pctRate: fp('0.05')})
    // Scenario starts in BEFORE_REBALANCING
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Set a simple basket
    const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
    const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

    // Setup a simple basket of two tokens, only target type A
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.5').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.5').sub(1))
    await scenario.setPrimeBasket()

    // Switch basket
    await scenario.refreshBasket()

    // Set backup config CA0 as backup
    await scenario.pushBackingForBackup(tokenIDs.get('CA0') as number)
    await scenario.setBackupConfig(0)

    // Status remains - still fully collateralized as no RTokens were issued
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Issue some RTokens
    // As Alice, make allowances
    const [tokenAddrs, amts] = await comp.rToken.quote(400000n * exa, RoundingMode.CEIL)
    for (let i = 0; i < amts.length; i++) {
      const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
      await token.connect(alice).approve(comp.rToken.address, amts[i])
    }
    // Issue RTokens
    await scenario.connect(alice).justIssue(400000n * exa)

    // No c0 tokens in backing manager
    expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

    // Stake some amount of RSR
    await scenario.connect(alice).stake(100000n * exa)

    // Default one token in the basket CA2
    const defaultTokenId = Number(tokenIDs.get('CA2'))
    const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(c2.address))
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)
    expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)

    await scenario.updatePrice(defaultTokenId, 0, fp(1), fp(1), fp(1)) // Will default CA2
    // Call main poke to perform refresh on assets
    await scenario.poke()

    // Collateral defaulted
    expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
    expect(await comp.basketHandler.fullyCollateralized()).to.equal(false)

    // Trying to manage tokens will fail due to unsound basket
    await scenario.pushBackingToManage(2)
    await scenario.pushBackingToManage(4)
    await expect(scenario.rebalance(1)).to.be.reverted // BATCH_AUCTION

    // We are still in initial state
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Cannot save basket range - Properties hold
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    await warmup()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

    // Refresh basket - will perform basket switch - New basket: CA1 and CA0
    await scenario.refreshBasket()

    // Rebalancing has started
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)

    while ((await scenario.status()) == RebalancingScenarioStatus.REBALANCING_ONGOING) {
      // Check echidna property is true at all times in the process...
      await scenario.pushSeedForTrades(fp(100000))

      await warmup()
      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Manage backing tokens, will create auction
      await scenario.rebalance(1) // BATCH_AUCTION
      if ((await scenario.status()) != RebalancingScenarioStatus.REBALANCING_ONGOING) break

      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      expect(await comp.backingManager.tradesOpen()).to.equal(1)

      const trade = await ConAt('GnosisTradeMock', await comp.broker.lastOpenedTrade())
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.be.false

      // Wait and settle the trade
      await advanceTime(await comp.broker.batchAuctionLength())
      expect(await trade.canSettle()).to.be.true

      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Settle trades - will use previous seed > 0
      await scenario.settleTrades()

      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      expect(await trade.status()).to.equal(TradeStatus.CLOSED)
      expect(await comp.backingManager.tradesOpen()).to.equal(0)
    }

    // Check rebalanced status...
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_DONE)
    expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)
    expect(await scenario.echidna_isFullyCollateralizedAfterRebalancing()).to.be.true

    // Property noop after rebalancing, returns true. Properties hold.
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
  })

  describe('contains the fix for the bug where', () => {
    it('manageTokens() reverting due to an invalid BU rate violates expectations', async () => {
      await warmup()
      await scenario.connect(alice).issue(1)
      await scenario.unregisterAsset(0)
      await scenario.refreshBasket()
      await warmup()
      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    })

    it('the rToken invariant had an underflowing index computation', async () => {
      await warmup()
      await scenario.connect(alice).issue(20_000n * exa)
      await advanceTime(1)
      await advanceBlocks(1)
      expect(await scenario.callStatic.echidna_rTokenInvariants()).to.be.true
    })

    it('the quoteProportional property would fail right after a hard default', async () => {
      await warmup()
      await scenario.connect(alice).issue(1000)
      await scenario.updatePrice(20, 0, 0, 0, 0) // reduces refPerTok and forces a hard default.
      expect(await scenario.callStatic.echidna_quoteProportionalWhenFullyCollateralized()).be.true
    })
  })

  it('sends rtoken donations to the backing manager', async () => {
    const tokenAddr = await main.someToken(0)
    const token = await ConAt('ERC20Fuzz', tokenAddr)
    const amt = fp('10')
    const bmBalBefore = await token.balanceOf(comp.backingManager.address)
    const rTokBalBefore = await token.balanceOf(comp.rToken.address)
    await token.connect(alice).transfer(comp.rToken.address, amt)
    await scenario.monetizeDonations(0)
    const bmBalAFter = await token.balanceOf(comp.backingManager.address)
    const rTokBalAfter = await token.balanceOf(comp.rToken.address)
    expect(rTokBalAfter).to.equal(0)
    expect(bmBalAFter).to.equal(bmBalBefore.add(rTokBalBefore).add(amt))
  })

  it('issue/redeem not allowed during a rebalance', async () => {
    await warmup()
    // similar case to false negatives seen in fuzzing
    await advanceBlocks(1)
    await advanceTime(1)
    await scenario.connect(alice).issue(1)
    await scenario.connect(alice).updatePrice(bn('121264033233888225265565220287352453623468700216813183789095321412050641'),0,0,bn('3345326469100492675282932145461459020125568694023126'),bn('191742294295487260193499953977383353501355709782'))
    await scenario.connect(alice).refreshBasket()
    await expect(scenario.connect(alice).justIssue(1)).revertedWith("Not valid for current state")
    await expect(scenario.connect(alice).justIssueTo(1, 0)).revertedWith("Not valid for current state")
    await expect(scenario.connect(alice).issue(1)).revertedWith("Not valid for current state")
    await expect(scenario.connect(alice).issueTo(1, 0)).revertedWith("Not valid for current state")
    await expect(scenario.connect(alice).redeem(1, await comp.basketHandler.nonce())).revertedWith("Not valid for current state")
    await expect(scenario.connect(alice).redeemTo(1, 0, await comp.basketHandler.nonce())).revertedWith("Not valid for current state")
  })

  it('uses the current basket to run the rebalancingProperties invariant', async () => {
    await warmup()
    await scenario.connect(alice).issueTo(1,0)
    await scenario.connect(alice).unregisterAsset(0)
    await scenario.connect(alice).pushBackingToManage(bn('150835712417908919285644013065474027887448859297381733494843312354601897167'))
    await scenario.connect(alice).refreshBasket()
    await scenario.connect(alice).pushBackingToManage(bn('6277620527355649775567068284304829410240875426814377481773201392576289608'))
    await warmup()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
  })

  it('does not check basket range invariant if a natural range change occurs (claim rewards)', async () => {
    await warmup()
    await advanceBlocks(1)
    await advanceTime(18)
    await scenario.connect(alice).issue(15)
    await scenario.connect(alice).updateRewards(bn('5989074762477379593905432766392491628643188479108275170789277813070778'), bn('12263554421802902403200938667897536687116647395531351968278586982578834557'))
    await scenario.connect(alice).swapRegisteredAsset(0,0,bn('586768731244946216864435810688149951399342547346310326714'),0,false,false,0)
    await scenario.connect(alice).refreshBasket()
    await scenario.connect(alice).claimRewards(2)
    const check = await scenario.echidna_basketRangeSmallerWhenRebalancing()
    expect(check).to.equal(true)
  })

  it('does not check basket range invariant if a natural range change occurs (price update)', async () => {
    await warmup()
    await advanceBlocks(1)
    await advanceTime(1)
    await scenario.connect(alice).issue(101)
    await scenario.connect(alice).swapRegisteredAsset(0,0,0,0,false,false,755084)
    await scenario.connect(alice).refreshBasket()
    await scenario.connect(alice).updatePrice(bn('4323490466645790929141000681379989217343309331490685561636627260745769225206'),bn('67360096239366422136176627671622570761630213553489626664'),bn('448235445655748428353993347788358432613042269770005933435'),bn('166780645086412136133053140534918526494436220154790922420'),bn('311571270105666158381426195843102477030798339529245571675'))
    const check = await scenario.echidna_basketRangeSmallerWhenRebalancing()
    expect(check).to.equal(true)
  })

  it('does not revert if warmup period has not passed when checking echidna_rebalancingProperties', async () => {
    await advanceTime(259874)
    await advanceBlocks(37)
    await scenario.connect(alice).issue(1)
    await scenario.connect(alice).unregisterAsset(0)
    await scenario.connect(alice).refreshBasket()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
  })

  it('does not revert if trading delay has not passed when checking echidna_rebalancingProperties', async () => {
    await scenario.connect(alice).pushBackingForPrimeBasket(bn('2534475810960463152805528040151'), 0)
    await scenario.connect(alice).setPrimeBasket()
    await advanceTime(261386)
    await advanceBlocks(405)
    await scenario.connect(alice).setBackingManagerTradingDelay(1)
    await scenario.connect(alice).issue(1)
    await scenario.connect(alice).refreshBasket()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
  })
})