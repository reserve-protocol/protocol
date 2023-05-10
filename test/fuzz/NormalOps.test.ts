import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer, BigNumber } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { fp } from '../../common/numbers'
import { whileImpersonating } from '../../test/utils/impersonation'
import { RoundingMode, TradeStatus, CollateralStatus } from '../../common/constants'
import { advanceBlocks, advanceTime } from '../../test/utils/time'
import commonTests, { FuzzTestContext } from './commonTests'

import { addr } from './common'
import { NormalOpsScenario } from '@typechain/NormalOpsScenario'
import { MainP1Fuzz } from '@typechain/MainP1Fuzz'
import { IMainFuzz } from '@typechain/IMainFuzz'

const user = (i: number) => addr((i + 1) * 0x10000)
const ConAt = ethers.getContractAt
const F = ethers.getContractFactory
const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6

// { gasLimit: 0x1ffffffff }

const componentsOf = async (main: IMainFuzz) => ({
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

describe('The Normal Operations scenario', () => {
  let scenario: NormalOpsScenario
  let main: MainP1Fuzz
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
    scenario = await (await F('NormalOpsScenario')).deploy({ gasLimit: 0x1ffffffff })
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
    const syms = ['C0', 'C1', 'C2', 'R0', 'R1', 'USD0', 'USD1', 'USD2']
    expect(await main.numTokens()).to.equal(syms.length)
    for (const sym of syms) {
      const tokenAddr = await main.tokenBySymbol(sym)
      const token = await ConAt('ERC20Fuzz', tokenAddr)
      expect(await token.symbol()).to.equal(sym)
      for (let u = 0; u < 3; u++) {
        expect(await token.balanceOf(user(u))).to.equal(fp(1e6))
      }
      await comp.assetRegistry.toAsset(tokenAddr)
    }

    // assets and collateral
    const erc20s = await comp.assetRegistry.erc20s()
    expect(erc20s.length).to.equal(10)
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

    expect(await comp.basketHandler.status()).to.equal(CollateralStatus.SOUND)
  })

  it('has only initially-true properties', async () => {
    expect(await scenario.echidna_ratesNeverFall()).to.be.true
    expect(await scenario.echidna_isFullyCollateralized()).to.be.true
    expect(await scenario.echidna_quoteProportionalToBasket()).to.be.true

    // emulate echidna_refreshBasketIsNoop, since it's not a view and we need its value
    await comp.basketHandler.savePrev()
    await whileImpersonating(scenario.address, async (asOwner) => {
      await comp.basketHandler.connect(asOwner).refreshBasket()
    })
    expect(await comp.basketHandler.prevEqualsCurr()).to.be.true
  })

  describe('does not have the bug in which', () => {
    it('refreshBasket fails after just one call to updatePrice', async () => {
      await scenario.updatePrice(0, 0, 0, 0, 0)

      // emulate echidna_refreshBasketIsNoop, since it's not a view and we need its value
      await comp.basketHandler.savePrev()
      await whileImpersonating(scenario.address, async (asOwner) => {
        await comp.basketHandler.connect(asOwner).refreshBasket()
      })
      expect(await comp.basketHandler.prevEqualsCurr()).to.be.true
    })

    it('rates fall after a tiny issuance', async () => {
      await warmup()
      await scenario.connect(alice).issue(1)
      expect(await scenario.echidna_ratesNeverFall()).to.be.true
    })

    it('backingManager issues double revenue', async () => {
      await warmup()
      // Have some RToken in existance
      await scenario.connect(alice).issue(1e6)

      // cause C0 to grow against its ref unit
      await scenario.updatePrice(0, fp(1.1), 0, 0, fp(1))

      // call manageTokens([C0, C0])
      await scenario.pushBackingToManage(0)
      await scenario.pushBackingToManage(0)
      await expect(scenario.manageBackingTokens()).to.be.reverted

      expect(await scenario.echidna_isFullyCollateralized()).to.be.true
    })

    it('stRSR tries to pay revenue to no stakers', async () => {
      await advanceTime(600000)
      await scenario.distributeRevenue(0, 0, exa)
      await advanceTime(200000)
      await scenario.payRSRProfits()
      await advanceTime(600000)
      await scenario.payRSRProfits()
      expect(await scenario.callStatic.echidna_stRSRInvariants()).to.be.true
    })

    it('stRSRInvariants has an out-of-bounds access', async () => {
      await scenario.connect(alice).stake(1)
      await scenario.connect(alice).unstake(1)
      await advanceTime(1213957)
      await scenario.connect(alice).withdrawAvailable()
      expect(await scenario.callStatic.echidna_stRSRInvariants()).to.be.true
      // fails due to Panic(0x32), out-of-bounds array access
    })

    it('rate falling after distributing revenue, staking, and unstaking', async () => {
      await advanceTime(410_000)
      await scenario.distributeRevenue(0, 0, 50) // Distribute 50 atto RSR from alice
      await advanceTime(410_000)
      await scenario.connect(alice).stake(1)
      await advanceTime(410_000)
      await scenario.connect(alice).unstake(1)

      expect(await scenario.callStatic.echidna_ratesNeverFall()).to.be.true
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
})
