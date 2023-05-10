import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer, BigNumber } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { bn, fp } from '../../common/numbers'
import { whileImpersonating } from '../utils/impersonation'
import { CollateralStatus, RoundingMode, TradeStatus } from '../../common/constants'
import { advanceBlocks, advanceTime } from '../utils/time'

import * as sc from '../../typechain' // All smart contract types

import { addr, PriceModelKind } from './common'

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

describe('The Chaos Operations scenario', () => {
  let scenario: sc.ChaosOpsScenario
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
    scenario = await (await F('ChaosOpsScenario')).deploy({ gasLimit: 0x1ffffffff })
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

      // Unregister a collateral from backup config - SA2
      await scenario.unregisterAsset(7)

      let updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(erc20s.length - 1)

      // Register collateral again for target A, avoid creating a new token
      // Will create an additional reward token
      await scenario.registerAsset(7, 0, exa, 2n ** 47n, 1, exa, 0)

      updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(erc20s.length)

      // Swap collateral in main basket - CA2 - for same type
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))
      const currentColl = await ConAt(
        'CollateralMock',
        await comp.assetRegistry.toColl(token.address)
      )

      await scenario.swapRegisteredAsset(4, exa, 2n ** 47n, 2, 0, 0)

      const newColl = await ConAt('CollateralMock', await comp.assetRegistry.toColl(token.address))

      expect(currentColl.address).to.not.equal(newColl.address)
      expect(await currentColl.erc20()).to.equal(await newColl.erc20())
    })

    it('can create stable+ collateral with reward', async () => {
      const erc20s = await comp.assetRegistry.erc20s()

      // Unregister a collateral from backup config - SA2
      await scenario.unregisterAsset(7)
      let updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(erc20s.length - 1)

      // Register STABLE collateral for target A, avoid creating a new token
      await scenario.registerAsset(7, 0, exa, 2n ** 47n, true, false, 0)

      // Registered the new collateral and the reward asset
      updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(erc20s.length)

      // Check collateral values
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('SA2'))
      const newColl = await ConAt('CollateralMock', await comp.assetRegistry.toColl(token.address))

      const [low, high] = await newColl.price()

      expect(low.add(high).div(2)).equal(fp(1))
      expect(await newColl.refPerTok()).equal(fp(1))
      expect(await newColl.targetPerRef()).equal(fp(1))

      // Set reward asset
      await scenario.setRewardToken(7, 6)
      const rewardToken = await ConAt('ERC20Fuzz', await token.rewardToken())
      expect(await rewardToken.symbol()).to.equal('SA1')
    })

    it('can create random collateral with new token and reward', async () => {
      const erc20s = await comp.assetRegistry.erc20s()

      // Push some price models, by default uses STABLE Price Model
      // Note: Will use STABLE for the remaining price models
      await scenario.pushPriceModel(0, fp('5'), 0, 0) // for Reward asset - Constant
      await scenario.pushPriceModel(3, fp('1'), fp('1'), fp('1.5')) // for ref per tok in collateral- Walk
      await scenario.pushPriceModel(1, fp('2'), fp('2'), fp('2')) // for target per ref in collateral- Manual
      await scenario.pushPriceModel(2, fp('1'), fp('0.9'), fp('1.1')) // stable for uoa per target
      await scenario.pushPriceModel(2, fp('1'), fp('0.9'), fp('1.1')) // stable for deviation

      // Register a new non-stable collateral from a new token
      const tokenID = await main.numTokens()
      await scenario.createToken(3, 'Fnord', 'F')

      // Register another new token to be the new collateral's reward
      const rewardID = await main.numTokens()
      await scenario.createToken(3, 'FnordReward', 'frfr')
      await scenario.registerAsset(tokenID, 3, exa, 2n ** 47n, true, false, 0)
      await scenario.registerAsset(rewardID, 3, exa, 2n ** 47n, false, false, 0)
      await scenario.setRewardToken(tokenID, rewardID)

      // Check new tokens registered
      const updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(erc20s.length + 2)

      // Check collateral values - RANDOM - Created with symbol CA3 (next index available)
      const newToken = await ConAt('ERC20Fuzz', await main.someToken(tokenID))
      await ConAt('CollateralMock', await comp.assetRegistry.toColl(newToken.address))
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
      expect(amts[6]).to.eq(fp('0.1'))
      expect(amts[7]).to.eq(fp('0.1'))
      expect(amts[8]).to.eq(fp('0.1'))
    })

    it('can handle freezing/pausing with roles', async () => {
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
      await expect(scenario.manageBackingTokens()).to.be.reverted

      // Refresh basket - will perform basket switch - New basket: CA1 and CA0
      await scenario.refreshBasket()

      await warmup()
      // Manage backing tokens, will create auction
      await scenario.manageBackingTokens()

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
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.be.true
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
    await expect(scenario.manageBackingTokens()).to.be.reverted
  })

  it('does not have the delay-until-default overflow bug', async () => {
    await scenario.swapRegisteredAsset(
      211,
      157198260n,
      2n ** 48n - 1n,
      115792089237316195423570985008687907853269984665640564039457584007913129639905n,
      79675224655379746186334390283315537261450992776061862950001213325377990300223n,
      4235709850086879078532699846656405640394575840079n
    )
    await scenario.updatePrice(
      140827145886041130406477407007091260019704506754017261163974533042926915192n,
      54142885896898819587641223640411918675755626942908228227n,
      9950722228327046074260525784078893627426407708962897489n,
      677188063638235783582474346933848320380794452695779245401n,
      49279736653971645409689279658046532938455123567655678904n
    )
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.be.true
    // In the failing case, we'd get Panic(0x11): arithmetic overflow or underflow.
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

  // it.only('does not allow rtoken rates to fall', async () => {
  //   await advanceTime(2)
  //   await advanceBlocks(376)
  //   await scenario.connect(alice).issueTo(bn('3'), bn('0'))
  //   await scenario.connect(alice).swapRegisteredAsset(bn('0'), bn('2931387367511778903507664448100344197073717920680885052632909040772'), bn('0'), bn('28160365735525868814080538303451678144713499979525835012245729939'), bn('0'), bn('9162468231347710210253343401769384326093180527477684595995854308'))
  //   await scenario.connect(alice).refreshBasket()
  //   await scenario.connect(alice).manageBackingTokens()
  //   expect(await scenario.echidna_ratesNeverFall()).equal(true)
  // })
})