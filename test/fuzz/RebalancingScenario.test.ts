import { expect } from 'chai'
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
import { advanceBlocks, advanceTime, setNextBlockTimestamp } from '../utils/time'
import { RebalancingScenario } from '@typechain/RebalancingScenario'
import {
  RebalancingScenarioStatus,
  Components,
  FuzzTestContext,
  componentsOf,
  FuzzTestFixture,
  ConAt,
  F,
  exa,
  user,
} from './common'
import { bn, fp } from '#/common/numbers'
import { CollateralStatus } from '../plugins/individual-collateral/pluginTestTypes'
import { RoundingMode, TradeStatus } from '#/common/constants'

type Fixture<T> = () => Promise<T>

enum BidType {
  NONE,
  CALLBACK,
  TRANSFER,
}

const createFixture: Fixture<FuzzTestFixture> = async () => {
  let scenario: RebalancingScenario
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
  let scenario: RebalancingScenario
  let main: MainP1Fuzz
  let comp: Components
  let alice: Signer
  let tokenIDs: Map<string, number>
  let warmup: () => void

  beforeEach(async () => {
    const f = await loadFixture(createFixture)
    scenario = f.scenario as RebalancingScenario
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
    // deprecated 3.0.0
    // expect(await scenario.echidna_rTokenInvariants()).to.be.true
    expect(await scenario.echidna_stRSRInvariants()).to.be.true
    expect(await scenario.callStatic.echidna_refreshBasketIsNoopDuringAfterRebalancing()).to.be.true
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.be.true
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.be.true
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.be.true
    expect(await scenario.echidna_isFullyCollateralizedAfterRebalancing()).to.be.true
  })

  it('maintains basket invariants after refresh', async () => {
    await scenario.unregisterAsset(8)
    await scenario.setBackupConfig(0)
    await scenario.unregisterAsset(0)
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.equal(true)
    expect(await comp.basketHandler.isValidBasketAfterRefresh()).to.be.true
    expect(await comp.basketHandler.status()).to.equal(CollateralStatus.DISABLED)
  })

  it('can switch between reweightable/non-reweightable basket - only before REBALANCING', async () => {
    expect(await comp.basketHandler.reweightable()).to.be.false
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Set to reweightable
    await scenario.setReweightable(1)
    expect(await comp.basketHandler.reweightable()).to.be.true

    // Check refresh basket properties remain
    expect(await scenario.callStatic.echidna_refreshBasketProperties()).to.equal(true)
  })

  it('performs validations on set prime basket if non-reweightable', async () => {
    // Check current basket
    const [tokenAddrs] = await comp.basketHandler['quote(uint192,bool,uint8)'](1n * exa, true, RoundingMode.CEIL)

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
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.4').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB1') as number, fp('0.3').sub(1))

    // no `C` weights
    await expect(scenario.setPrimeBasket()).revertedWith('missing target weights')
    await expect(scenario.forceSetPrimeBasket()).revertedWith('missing target weights')

    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC1') as number, fp('0.3').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('SA1') as number, fp('0.1').sub(1))

    // over-weighted to `A`
    await expect(scenario.setPrimeBasket()).revertedWith('new target weights')
    await expect(scenario.forceSetPrimeBasket()).revertedWith('new target weights')

    // Remove the last one added
    await scenario.popBackingForPrimeBasket()

    await scenario.setPrimeBasket()

    // Refresh basket to be able to see updated config
    await comp.basketHandler.savePrev()
    await scenario.refreshBasket()

    const [newTokenAddrs, amts] = await comp.basketHandler['quote(uint192,bool,uint8)'](1n * exa, true, RoundingMode.CEIL)
    expect(await comp.basketHandler.prevEqualsCurr()).to.be.false
    expect(newTokenAddrs.length).to.equal(3)

    const tokenInBasket = await ConAt('ERC20Fuzz', newTokenAddrs[0])
    expect(await tokenInBasket.symbol()).to.equal('CA1')
    // 1/1,000,000% revenue hiding
    expect(amts[0]).to.closeTo(fp('0.4000004'), fp('0.00000001'))
    expect(amts[1]).to.closeTo(fp('0.3000003'), fp('0.00000001'))
    expect(amts[2]).to.closeTo(fp('0.3000003'), fp('0.00000001'))
  })

  it('can manage scenario states - basket switch - covered by RSR [Batch auction]', async () => {
    await warmup()

    // Recharge throttle
    await advanceTime(3600)

    // Scenario starts in BEFORE_REBALANCING
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Set a simple basket
    const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
    const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

    // Setup a new basket
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.2').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB0') as number, fp('0.3').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC0') as number, fp('0.3').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.2').sub(1))
    await scenario.setPrimeBasket()

    // Switch basket
    await scenario.refreshBasket()

    // Status remains - still fully collateralized as no RTokens were issued
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Issue some RTokens
    // As Alice, make allowances
    const [tokenAddrs, amts] = await comp.rToken.quote(300000n * exa, RoundingMode.CEIL)
    for (let i = 0; i < amts.length; i++) {
      const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
      await token.connect(alice).approve(comp.rToken.address, amts[i])
    }
    // Issue RTokens
    await scenario.connect(alice).justIssue(300000n * exa)

    // No c0 tokens in backing manager
    expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

    // Stake large amount of RSR
    await scenario.connect(alice).stake(100000n * exa)

    // Perform another basket switch - CA0 enters for CA2
    await scenario.popBackingForPrimeBasket()
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA0') as number, fp('0.2').sub(1))
    await scenario.setPrimeBasket()

    // We are still in initial state
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Cannot save basket range - Properties hold
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

    // ======== Begin rebalancing ========
    // Refresh basket - will perform basket switch - New basket: CA1, CB0, CC0, CA0
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
    await expect(
      scenario.swapRegisteredAsset(4, 0, exa, 2n ** 47n, true, true, 0)
    ).to.be.revertedWith('Not valid for current state')

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
        const sellToken = await ConAt('ERC20Mock', await trade.sell())
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

      await advanceTime(12)
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

  it('can manage scenario states - collateral default - partially covered by RSR [Batch auction]', async () => {
    await warmup()

    // Recharge throttle
    await advanceTime(3600)

    // Scenario starts in BEFORE_REBALANCING
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Set a simple basket
    const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
    const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

    // Setup a simple basket of two tokens, only target type A
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.2').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.2').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB0') as number, fp('0.3').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC0') as number, fp('0.3').sub(1))
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

  const bidTypes = [BidType.CALLBACK, BidType.TRANSFER] // TRANSFER and CALL
  bidTypes.forEach((bidType) => {
    it(`can manage scenario states - basket switch - covered by RSR [Dutch auction] - Bid Type: ${
      Object.values(BidType)[bidType]
    }`, async () => {
      await warmup()

      // Recharge throttle
      await advanceTime(3600)

      // Scenario starts in BEFORE_REBALANCING
      expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

      // Set a simple basket
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

      // Setup a new basket
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.2').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB0') as number, fp('0.3').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC0') as number, fp('0.3').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.2').sub(1))
      await scenario.setPrimeBasket()

      // Switch basket
      await scenario.refreshBasket()

      // Status remains - still fully collateralized as no RTokens were issued
      expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

      // Issue some RTokens
      // As Alice, make allowances
      const [tokenAddrs, amts] = await comp.rToken.quote(300000n * exa, RoundingMode.CEIL)
      for (let i = 0; i < amts.length; i++) {
        const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
        await token.connect(alice).approve(comp.rToken.address, amts[i])
      }
      // Issue RTokens
      await scenario.connect(alice).justIssue(300000n * exa)

      // No c0 tokens in backing manager
      expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

      // Stake large amount of RSR
      await scenario.connect(alice).stake(100000n * exa)

      // Perform another basket switch - CA0 enters for CA2
      await scenario.popBackingForPrimeBasket()
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA0') as number, fp('0.2').sub(1))
      await scenario.setPrimeBasket()

      // We are still in initial state
      expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

      // Cannot save basket range - Properties hold
      await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
      expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
      expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // ======== Begin rebalancing ========
      // Refresh basket - will perform basket switch - New basket: CA1, CB0, CC0, CA0
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
      await expect(scenario.popBackingForBackup(0)).to.be.revertedWith(
        'Not valid for current state'
      )
      await expect(scenario.setBackupConfig(0)).to.be.revertedWith('Not valid for current state')

      // Does not allow to change registered assets
      await expect(scenario.pushPriceModel(0, fp('5'), 0, 0)).to.be.revertedWith(
        'Not valid for current state'
      )
      await expect(scenario.unregisterAsset(7)).to.be.revertedWith('Not valid for current state')
      await expect(scenario.registerAsset(7, 0, exa, 2n ** 47n, true, true, 0)).to.be.revertedWith(
        'Not valid for current state'
      )
      await expect(
        scenario.swapRegisteredAsset(4, 0, exa, 2n ** 47n, true, true, 0)
      ).to.be.revertedWith('Not valid for current state')

      let iteration = 0
      while ((await scenario.status()) == RebalancingScenarioStatus.REBALANCING_ONGOING) {
        iteration++
        // We'll check the echidna properties at each step during rebalancing...
        expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
        expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
        await scenario.saveBasketRange()
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

        if (iteration == 1) {
          // Manage backing tokens, will create auction
          await scenario.rebalance(0) // DUTCH_AUCTION
        }
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
        await scenario.saveBasketRange()
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

        // Check trade
        const trade = await ConAt('DutchTrade', await comp.broker.lastOpenedTrade())

        expect(await comp.backingManager.tradesOpen()).to.equal(1)
        expect(await trade.status()).to.equal(TradeStatus.OPEN)
        expect(await trade.canSettle()).to.be.false

        if (iteration == 1) {
          const sellToken = await ConAt('ERC20Mock', await trade.sell())
          // The first trade is for C2 tokens.
          expect(await comp.backingManager.trades(c2.address)).to.equal(trade.address)
          // All c2 tokens have moved to trader
          expect(await c2.balanceOf(comp.backingManager.address)).to.equal(0)
          expect(await c2.balanceOf(trade.address)).to.be.gt(0)
        }

        // Cannot settle the trade yet
        await advanceTime(1)
        expect(await trade.canSettle()).to.be.false

        if (iteration == 1) {
          // No C0 tokens in backing manager
          expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

          // State remains ongoing
          expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)
        }

        // Advance time to settle trade
        await setNextBlockTimestamp(await trade.endTime() - 2)

        // Check echidna property is true at all times in the process
        expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
        expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

        // Settle trades - set some seed > 0
        await scenario.pushSeedForTrades(fp(1000000))
        await scenario.bidOpenDutchAuction(bidType)

        expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
        expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
        expect(await trade.status()).to.equal(TradeStatus.CLOSED)

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
  })

  bidTypes.forEach((bidType) => {
    it(`can manage scenario states - collateral default - partially covered by RSR [Dutch auction]  - Bid Type: ${
      Object.values(BidType)[bidType]
    }`, async () => {
      await warmup()

      // Recharge throttle
      await advanceTime(3600)

      // Scenario starts in BEFORE_REBALANCING
      expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

      // Set a simple basket
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

      // Setup a simple basket of two tokens, only target type A
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.2').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.2').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB0') as number, fp('0.3').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC0') as number, fp('0.3').sub(1))
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
      await expect(scenario.rebalance(0)).to.be.reverted // DUTCH_AUCTION

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
        await scenario.rebalance(0) // DUTCH_AUCTION
        if ((await scenario.status()) != RebalancingScenarioStatus.REBALANCING_ONGOING) break

        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
        await scenario.saveBasketRange()
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

        expect(await comp.backingManager.tradesOpen()).to.equal(1)

        const trade = await ConAt('GnosisTradeMock', await comp.broker.lastOpenedTrade())
        expect(await trade.status()).to.equal(TradeStatus.OPEN)
        expect(await trade.canSettle()).to.be.false

        // Wait and settle the trade
        await advanceTime((await comp.broker.dutchAuctionLength()) - 12)
        expect(await trade.canSettle()).to.be.false

        expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
        expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
        expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

        // Settle trades - will use previous seed > 0
        await scenario.bidOpenDutchAuction(bidType)

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

    /* deprecated 3.0.0
    *
    it('the rToken invariant had an underflowing index computation', async () => {
      await warmup()
      await scenario.connect(alice).issue(20_000n * exa)
      await advanceTime(1)
      await advanceBlocks(1)
      expect(await scenario.callStatic.echidna_rTokenInvariants()).to.be.true
    })
    *
    */

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
    await scenario
      .connect(alice)
      .updatePrice(
        bn('121264033233888225265565220287352453623468700216813183789095321412050641'),
        0,
        0,
        bn('3345326469100492675282932145461459020125568694023126'),
        bn('191742294295487260193499953977383353501355709782')
      )
    await scenario.connect(alice).refreshBasket()
    await expect(scenario.connect(alice).justIssue(1)).revertedWith('Not valid for current state')
    await expect(scenario.connect(alice).justIssueTo(1, 0)).revertedWith(
      'Not valid for current state'
    )
    await expect(scenario.connect(alice).issue(1)).revertedWith('Not valid for current state')
    await expect(scenario.connect(alice).issueTo(1, 0)).revertedWith('Not valid for current state')
    await expect(scenario.connect(alice).redeem(1)).revertedWith('Not valid for current state')
    await expect(scenario.connect(alice).redeemTo(1, 0)).revertedWith('Not valid for current state')
  })

  it('uses the current basket to run the rebalancingProperties invariant', async () => {
    await warmup()
    await scenario.connect(alice).issueTo(1, 0)
    await scenario.connect(alice).unregisterAsset(0)
    await scenario
      .connect(alice)
      .pushBackingToManage(
        bn('150835712417908919285644013065474027887448859297381733494843312354601897167')
      )
    await scenario.connect(alice).refreshBasket()
    await scenario
      .connect(alice)
      .pushBackingToManage(
        bn('6277620527355649775567068284304829410240875426814377481773201392576289608')
      )
    await warmup()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
  })

  it('does not check basket range invariant if a natural range change occurs (claim rewards)', async () => {
    await warmup()
    await advanceBlocks(1)
    await advanceTime(18)
    await scenario.connect(alice).issue(15)
    await scenario
      .connect(alice)
      .updateRewards(
        bn('5989074762477379593905432766392491628643188479108275170789277813070778'),
        bn('12263554421802902403200938667897536687116647395531351968278586982578834557')
      )
    await scenario
      .connect(alice)
      .swapRegisteredAsset(
        0,
        0,
        bn('586768731244946216864435810688149951399342547346310326714'),
        0,
        false,
        false,
        0
      )
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
    await scenario.connect(alice).swapRegisteredAsset(0, 0, 0, 0, false, false, 755084)
    await scenario.connect(alice).refreshBasket()
    await scenario
      .connect(alice)
      .updatePrice(
        bn('4323490466645790929141000681379989217343309331490685561636627260745769225206'),
        bn('67360096239366422136176627671622570761630213553489626664'),
        bn('448235445655748428353993347788358432613042269770005933435'),
        bn('166780645086412136133053140534918526494436220154790922420'),
        bn('311571270105666158381426195843102477030798339529245571675')
      )
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

  it('reverts when trying to set a prime basket with bad target weights', async () => {
    await scenario
      .connect(alice)
      .pushBackingForPrimeBasket(bn('2534475810960463152805528040151'), 0)
    await expect(scenario.connect(alice).setPrimeBasket()).revertedWith(
      'missing target weights' // "can't rebalance bad weights"
    )
  })

  it('does not revert if trading delay has not passed when checking echidna_rebalancingProperties', async () => {
    await scenario
      .connect(alice)
      .pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.4').sub(1))
    await scenario
      .connect(alice)
      .pushBackingForPrimeBasket(tokenIDs.get('CB1') as number, fp('0.3').sub(1))
    await scenario
      .connect(alice)
      .pushBackingForPrimeBasket(tokenIDs.get('CC1') as number, fp('0.3').sub(1))
    await scenario.connect(alice).setPrimeBasket()
    await advanceTime(261386)
    await advanceBlocks(405)
    await scenario.connect(alice).setBackingManagerTradingDelay(1)
    await scenario.connect(alice).issue(1)
    await scenario.connect(alice).refreshBasket()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
  })

  it('invariants hold after unregistering an asset', async () => {
    await scenario.unregisterAsset(0)
    await scenario.echidna_RTokenRateNeverFallInNormalOps()
    await scenario.echidna_assetRegistryInvariants()
    await scenario.echidna_backingManagerInvariants()
    await scenario.echidna_basketInvariants()
    await scenario.echidna_basketRangeSmallerWhenRebalancing()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    await scenario.echidna_brokerInvariants()
    await scenario.echidna_distributorInvariants()
    await scenario.echidna_dutchRebalancingProperties()
    await scenario.echidna_furnaceInvariants()
    await scenario.echidna_isFullyCollateralizedAfterRebalancing()
    await scenario.echidna_mainInvariants()
    await scenario.echidna_quoteProportionalWhenFullyCollateralized()
    // deprecated 3.0.0
    // await scenario.echidna_rTokenInvariants()
    await scenario.echidna_rTokenTraderInvariants()
    await scenario.echidna_refreshBasketIsNoopDuringAfterRebalancing()
    await scenario.echidna_refreshBasketProperties()
    await scenario.echidna_rsrTraderInvariants()
    await scenario.echidna_stRSRInvariants()
  })

  it('invariants hold when collateral is swapped for asset', async () => {
    await scenario.swapRegisteredAsset(0, 0, 0, 0, false, false, 0)
    await scenario.echidna_RTokenRateNeverFallInNormalOps()
    await scenario.echidna_assetRegistryInvariants()
    await scenario.echidna_backingManagerInvariants()
    await scenario.echidna_basketInvariants()
    await scenario.echidna_basketRangeSmallerWhenRebalancing()
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
    await scenario.echidna_brokerInvariants()
    await scenario.echidna_distributorInvariants()
    await scenario.echidna_dutchRebalancingProperties()
    await scenario.echidna_furnaceInvariants()
    await scenario.echidna_isFullyCollateralizedAfterRebalancing()
    await scenario.echidna_mainInvariants()
    await scenario.echidna_quoteProportionalWhenFullyCollateralized()
    // deprecated 3.0.0
    // await scenario.echidna_rTokenInvariants()
    await scenario.echidna_rTokenTraderInvariants()
    await scenario.echidna_refreshBasketIsNoopDuringAfterRebalancing()
    await scenario.echidna_refreshBasketProperties()
    await scenario.echidna_rsrTraderInvariants()
    await scenario.echidna_stRSRInvariants()
  })

  it('batch/dutch rebalancing invariants do not revert when trading paused/frozen', async () => {
    await scenario
      .connect(alice)
      .updatePrice(
        19644723992999751208350494045766530200125210393077150444422589047217906672n,
        16725,
        5058189479640,
        43627242907532559232405580565409077363325895609410822214n,
        630843679904044625194364875020093875373857173300588n
      )

    await advanceTime(317791)
    await advanceBlocks(1920)
    await scenario.connect(alice).unregisterAsset(94)
    await scenario.connect(alice).popBackingForPrimeBasket()
    await scenario
      .connect(alice)
      .pushBackingToManage(
        12213386188114833924664821831843165928403016551323024774161052899605265286n
      )
    await scenario.connect(alice).settleTrades()
    await scenario.connect(alice).issueTo(6, 2)
    await scenario.connect(alice).grantRole(215, 216)
    await scenario
      .connect(alice)
      .updatePrice(
        1489,
        0,
        9913719922279493n,
        627,
        7849854438085354948439501330461722698416510930281213061n
      )
    await scenario.connect(alice).cacheComponents()
    await scenario
      .connect(alice)
      .setDistribution(
        15475443167430409094351642319236168528644600775941740751342847184876354901n,
        1124,
        0
      )
    await scenario
      .connect(alice)
      .setDutchAuctionLength(
        5850907544017889919933267860033113287156564268699488973556489822315457n
      )

    await scenario
      .connect(alice)
      .pushBackingForPrimeBasket(
        19750100934234991117038522000942198263237056376417451289528335263024183079n,
        36830527281313525790028296859245195943407920495065737971428105050793160861n
      )
    await scenario.connect(alice).pauseTrading()
    await scenario.connect(alice).unregisterAsset(1)
    await scenario.connect(alice).burn(1, 1, 1)

    await scenario
      .connect(alice)
      .pushBackingForBackup(
        16824187482170915740062314350899062168539604998382719666937984059624800114n
      )

    await scenario.connect(alice).refreshBasket()

    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)
    expect(await main.tradingPaused()).to.equal(true)
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)

    // unpause
    await scenario.connect(alice).unpauseTrading()
    expect(await main.tradingPaused()).to.equal(false)
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)

    // freeze
    await scenario.connect(alice).grantRole(1, 0)
    await scenario.connect(alice).freezeShort()
    expect(await main.frozen()).to.equal(true)
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)

    // unfreeze
    await scenario.grantRole(0, 0) // grant OWNER role
    await scenario.connect(alice).unfreeze()
    expect(await main.frozen()).to.equal(false)
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.equal(true)
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.equal(true)
  })

  it('Handles small deviations from basket range check', async () => {
    await scenario.setReweightable(1)
    const s0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('SA0'))

    // Setup a new basket C0 and C1 only
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA0') as number, fp('0.4').sub(1))
    await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.6').sub(1))
    await scenario.forceSetPrimeBasket()

    // Set backup config SA0, SA1, SA2 as backup
    await scenario.pushBackingForBackup(tokenIDs.get('SA0') as number)
    await scenario.pushBackingForBackup(tokenIDs.get('SA1') as number)
    await scenario.pushBackingForBackup(tokenIDs.get('SA2') as number)
    await scenario.setBackupConfig(0)

    // Switch basket
    await scenario.refreshBasket()

    await advanceTime(301137)
    await advanceBlocks(10543)

    await scenario.connect(alice).issueTo('61', 0) // 61

    // No s0 tokens in backing manager
    expect(await s0.balanceOf(comp.backingManager.address)).to.equal(0)

    // Unregister C0, first asset in basket
    await scenario.connect(alice).unregisterAsset(0)
    await scenario.connect(alice).refreshBasket()

    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.be.true
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.be.true

    await advanceTime(304430)
    await advanceBlocks(8789)

    // Set minTradeVolume to 0 - properties hold
    await scenario.connect(alice).setBackingManagerMinTradeVolume(0)
    expect(await scenario.callStatic.echidna_batchRebalancingProperties()).to.be.true
    expect(await scenario.callStatic.echidna_dutchRebalancingProperties()).to.be.true
  })
}

const context: FuzzTestContext<FuzzTestFixture> = {
  f: createFixture,
  testType: 'Rebalancing',
  scenarioSpecificTests,
}

fuzzTests(context)
abnormalTests(context)
