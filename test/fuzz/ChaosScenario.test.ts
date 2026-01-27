import { ethers } from 'hardhat'
import { Signer, Wallet } from 'ethers'
import fuzzTests from './commonTests'
import abnormalTests from './commonAbnormalTests'
import { MainP1Fuzz } from '@typechain/MainP1Fuzz'
import {
  impersonateAccount,
  loadFixture,
  mine,
  setBalance,
} from '@nomicfoundation/hardhat-network-helpers'
import { advanceBlocks, advanceTime } from '../utils/time'
import { ChaosOpsScenario } from '@typechain/ChaosOpsScenario'
import { expect } from 'chai'
import { whileImpersonating } from '../utils/impersonation'
import { CollateralStatus } from '../plugins/individual-collateral/pluginTestTypes'
import { fp } from '#/common/numbers'
import {
  Components,
  FuzzTestContext,
  componentsOf,
  FuzzTestFixture,
  ConAt,
  F,
  exa,
  user,
} from './common'
import { RoundingMode, TradeStatus } from '#/common/constants'

type Fixture<T> = () => Promise<T>

const createFixture: Fixture<FuzzTestFixture> = async () => {
  let scenario: ChaosOpsScenario
  let main: MainP1Fuzz
  let comp: Components

  let owner: Wallet
  let alice: Signer
  let bob: Signer
  let carol: Signer

  let aliceAddr: string
  let bobAddr: string
  let carolAddr: string

  let collaterals: string[] = ['CA0', 'CA1', 'CA2', 'CB0', 'CB1', 'CB2', 'CC0', 'CC1', 'CC2']
  let rewards: string[] = ['RA0', 'RA1', 'RB0', 'RB1', 'RC0', 'RC1']
  let stables: string[] = ['SA0', 'SA1', 'SA2', 'SB0', 'SB1', 'SB2', 'SC0', 'SC1', 'SC2']

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

  await setBalance(aliceAddr, exa * exa)
  await setBalance(bobAddr, exa * exa)
  await setBalance(carolAddr, exa * exa)
  await setBalance(main.address, exa * exa)

  await impersonateAccount(aliceAddr)
  await impersonateAccount(bobAddr)
  await impersonateAccount(carolAddr)
  await impersonateAccount(main.address)

  await mine(300, { interval: 12 }) // charge battery

  warmupPeriod = await comp.basketHandler.warmupPeriod()

  return {
    scenario,
    main,
    comp,
    owner,
    alice,
    bob,
    carol,
    aliceAddr,
    bobAddr,
    carolAddr,
    addrIDs,
    tokenIDs,
    warmup,
    collaterals,
    rewards,
    stables,
  }
}

const scenarioSpecificTests = () => {
  let scenario: ChaosOpsScenario
  let main: MainP1Fuzz
  let comp: Components
  let alice: Signer
  let tokenIDs: Map<string, number>
  let warmup: () => void

  beforeEach(async () => {
    const f = await loadFixture(createFixture)
    scenario = f.scenario as ChaosOpsScenario
    main = f.main
    comp = f.comp
    alice = f.alice
    tokenIDs = f.tokenIDs
    warmup = f.warmup
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

    // Uses reweightable basket
    expect(await comp.basketHandler.reweightable()).to.be.true

    expect(await comp.basketHandler.enableIssuancePremium()).to.equal(true)
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

    await scenario.swapRegisteredAsset(4, exa, 2n ** 47n, 2, 0, 0)

    const newColl = await ConAt('CollateralMock', await comp.assetRegistry.toColl(token.address))

    expect(currentColl.address).to.not.equal(newColl.address)
    expect(await currentColl.erc20()).to.equal(await newColl.erc20())
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
    // deprecated 3.0.0
    // expect(await scenario.echidna_rTokenInvariants()).to.be.true
    expect(await scenario.echidna_stRSRInvariants()).to.be.true
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.be.true

    // Reentrancy properties
    expect(await scenario.echidna_no_reentrancy_succeeded()).to.be.true
    expect(await scenario.echidna_all_reentrancies_revert()).to.be.true
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

  it('allows to set attack target', async () => {
    await scenario.setReentrancyTarget(5) // STRSR_UNSTAKE
    expect(await scenario.reentrancyTarget()).to.equal(5)
  })

  it('accepts all valid attack target values', async () => {
    // Test all valid enum values (0-13)
    for (let i = 0; i <= 13; i++) {
      await scenario.setReentrancyTarget(i)
      expect(await scenario.reentrancyTarget()).to.equal(i)
    }
  })

  it('all tokens in basket are reentrant', async () => {
    // Check current basket, all tokens should be registered as reentrant
    const [tokenAddrs] = await comp.basketHandler['quote(uint192,bool,uint8)'](
      1n * exa,
      true,
      RoundingMode.CEIL
    )
    const reentrantTokens = await scenario.getReentrantTokens()
    for (let i = 0; i < tokenAddrs.length; i++) {
      expect(reentrantTokens.includes(tokenAddrs[i])).to.equal(true)
    }
  })

  it('tracks reentrancy attempts on issuance', async () => {
    await warmup()

    // Initially no reentrancy attempts
    expect(await scenario.attemptedReentrancies()).to.equal(0)
    expect(await scenario.failedReentrancies()).to.equal(0)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(0)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // Enable reentrancy attack on first collateral token CA0
    const tokenIndex = 2 // CA0 token index
    await scenario.setReentrancyAttack(tokenIndex, 5) // Enable attack

    // Set reentrancy target to RToken redeem
    await scenario.setReentrancyTarget(1) // RTOKEN_REDEEM

    // Issue RTokens - this will trigger transfers of collateral tokens
    const issueAmount = fp('100')
    await scenario.connect(alice).issueTo(issueAmount, 0)

    // Check that reentrancy was attempted but failed
    expect(await scenario.attemptedReentrancies()).to.equal(1)
    expect(await scenario.failedReentrancies()).to.equal(1)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(1)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // Verify reentrancy properties still hold
    expect(await scenario.echidna_no_reentrancy_succeeded()).to.be.true
    expect(await scenario.echidna_all_reentrancies_revert()).to.be.true

    // Disable attacks and issue again (no attempt should be registered)
    await scenario.setReentrancyAttack(tokenIndex, 30) // Enable attack
    await scenario.connect(alice).issueTo(issueAmount, 0)

    // No new attempt registered
    expect(await scenario.attemptedReentrancies()).to.equal(1)
    expect(await scenario.failedReentrancies()).to.equal(1)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(1)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // Reentrancy properties still hold
    expect(await scenario.echidna_no_reentrancy_succeeded()).to.be.true
    expect(await scenario.echidna_all_reentrancies_revert()).to.be.true
  })

  it('tracks reentrancy attempts during redemption', async () => {
    await warmup()

    // Initially no reentrancy attempts
    expect(await scenario.attemptedReentrancies()).to.equal(0)
    expect(await scenario.failedReentrancies()).to.equal(0)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(0)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // First issue some RTokens to Alice so she can redeem
    await scenario.connect(alice).issueTo(fp('1000'), 0)

    // Enable attack on multiple collateral tokens
    await scenario.setReentrancyAttack(2, 5)
    await scenario.setReentrancyAttack(3, 8)
    await scenario.setReentrancyAttack(4, 35) // CA2 - Should disable

    // Set target to StRSR stake (try to re-enter during redemption)
    await scenario.setReentrancyTarget(4) // STRSR_STAKE

    // Redeem RTokens - this will transfer collateral tokens out
    await scenario.connect(alice).redeem(fp('100'))

    // Should have one attempt from enabled tokens (CA0 and CA1)
    expect(await scenario.attemptedReentrancies()).to.equal(1)
    expect(await scenario.failedReentrancies()).to.equal(1)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(1)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // All attempts should fail
    expect(await scenario.attemptedReentrancies()).to.equal(await scenario.failedReentrancies())
    expect(await scenario.reentrancySucceeded()).to.equal(false)
  })

  it('tracks reentrancy attempts during monetizeDonations', async () => {
    await warmup()

    // Initially no reentrancy attempts
    expect(await scenario.attemptedReentrancies()).to.equal(0)
    expect(await scenario.failedReentrancies()).to.equal(0)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(0)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // Enable attack on a collateral token
    const tokenIndex = 2 // CA0
    await scenario.setReentrancyAttack(tokenIndex, 7)
    await scenario.setReentrancyTarget(8) // BACKING_REBALANCE

    const token = await ConAt('ERC20ReentrantFuzz', await main.someToken(tokenIndex))

    // Send tokens to RToken as donation
    await token.mint(comp.rToken.address, fp('100'))

    // Monetize donations - this triggers transfer with globalNonReentrant
    await scenario.monetizeDonations(tokenIndex)

    // Should have one attempt
    expect(await scenario.attemptedReentrancies()).to.equal(1)
    expect(await scenario.failedReentrancies()).to.equal(1)
    expect(await scenario.blockedByGuardReentrancies()).to.equal(1)
    expect(await scenario.reentrancySucceeded()).to.equal(false)

    // All attempts should fail
    expect(await scenario.attemptedReentrancies()).to.equal(await scenario.failedReentrancies())
    expect(await scenario.reentrancySucceeded()).to.equal(false)
  })

  it('regression test -> stRSRInvariants hold in stake/unstake/seize/withdrawAvailable', async () => {
    expect(await scenario.echidna_stRSRInvariants()).to.be.true

    // Stake RSR
    await scenario.connect(alice).stake(2)
    await scenario.connect(alice).unstake(2)

    expect(await scenario.echidna_stRSRInvariants()).to.be.true

    await advanceTime(793926)
    await advanceBlocks(1)

    await scenario.seizeRSR(1)
    expect(await scenario.echidna_stRSRInvariants()).to.be.true

    await advanceTime(418187)
    await advanceBlocks(1)

    await scenario.connect(alice).withdrawAvailable()
    expect(await scenario.echidna_stRSRInvariants()).to.be.true
  })

  it('forceSettleTrade is a no-op when there is no trade', async () => {
    await warmup()

    // Get a token that has no trade (CA0)
    const tokenID = tokenIDs.get('CA0') as number
    const c0 = await ConAt('ERC20Fuzz', await main.someToken(tokenID))

    // Verify there's no trade for this token
    const tradeAddr = await comp.backingManager.trades(c0.address)
    expect(tradeAddr).to.equal(ethers.constants.AddressZero)

    // Call forceSettleTrade - should be a no-op, not revert
    await scenario.forceSettleTrade(tokenID)

    // Still no trade
    expect(await comp.backingManager.trades(c0.address)).to.equal(ethers.constants.AddressZero)
  })

  it('can force settle a backing manager trade using forceSettleTrade', async () => {
    await warmup()

    const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

    // Issue some RTokens
    const [tokenAddrs, amts] = await comp.rToken.quote(150000n * exa, RoundingMode.CEIL)
    for (let i = 0; i < amts.length; i++) {
      const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
      await token.connect(alice).approve(comp.rToken.address, amts[i])
    }
    await scenario.connect(alice).justIssue(150000n * exa)

    // Stake RSR for recollateralization
    await scenario.connect(alice).stake(100000n * exa)

    // Default CA2
    const defaultTokenId = tokenIDs.get('CA2') as number
    const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(c2.address))
    expect(await coll.status()).to.equal(CollateralStatus.SOUND)

    await scenario.updatePrice(defaultTokenId, 0, fp(1), fp(1), fp(1)) // Will default CA2
    await scenario.poke()

    expect(await coll.status()).to.equal(CollateralStatus.DISABLED)

    // Refresh basket to trigger basket switch
    await scenario.refreshBasket()
    await warmup()

    // Rebalance to create a trade
    await scenario.rebalance(1) // BATCH_AUCTION

    // Verify trade exists for c2 (the defaulted token being sold)
    const tradeAddr = await comp.backingManager.trades(c2.address)
    expect(tradeAddr).to.not.equal(ethers.constants.AddressZero)

    const tradeInBackingManager = await ConAt('GnosisTradeMock', tradeAddr)
    expect(await tradeInBackingManager.status()).to.equal(TradeStatus.OPEN)

    // Check tradesOpen before
    const tradesOpenBefore = await comp.backingManager.tradesOpen()
    expect(tradesOpenBefore).to.be.gt(0)

    // Use forceSettleTrade to remove trade from tracking
    // Note: forceSettleTrade is a governance escape hatch that removes the trade
    // from the backing manager's tracking without settling the underlying trade
    await scenario.forceSettleTrade(defaultTokenId)

    // Verify trade is removed from backing manager's trades mapping
    expect(await comp.backingManager.trades(c2.address)).to.equal(ethers.constants.AddressZero)

    // Verify tradesOpen decremented
    expect(await comp.backingManager.tradesOpen()).to.equal(tradesOpenBefore - 1)

    // Note: The underlying trade contract status remains OPEN since forceSettleTrade
    // is designed for bricked trades and doesn't interact with the trade contract
    expect(await tradeInBackingManager.status()).to.equal(TradeStatus.OPEN)
  })
}

const context: FuzzTestContext<FuzzTestFixture> = {
  f: createFixture,
  testType: 'Chaos',
  scenarioSpecificTests,
}

fuzzTests(context)
abnormalTests(context)
