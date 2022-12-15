import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer, BigNumber } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { fp } from '../../common/numbers'
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
    expect(await main.pausedOrFrozen()).to.equal(false)

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
    describe('contains a mock Broker, TradingMock, and MarketMock, which...', () => {
      it('lets users trade two fiatcoins', async () => {
        const usd0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('SA0'))
        const rsr = comp.rsr

        const alice_usd0_0 = await usd0.balanceOf(aliceAddr)
        const alice_rsr_0 = await rsr.balanceOf(aliceAddr)

        // Alice starts with 123 USD0
        await usd0.mint(aliceAddr, fp(123))

        const alice_usd0_1 = await usd0.balanceOf(aliceAddr)
        expect(alice_usd0_1.sub(alice_usd0_0)).to.equal(fp(123))

        // Init the trade
        const tradeReq = {
          buy: await comp.assetRegistry.toAsset(comp.rsr.address),
          sell: await comp.assetRegistry.toAsset(usd0.address),
          minBuyAmount: fp(456),
          sellAmount: fp(123),
        }

        const trade = await (await F('TradeMock')).deploy()

        // Alice sends 123 USD0 to the trade
        await usd0.connect(alice).transfer(trade.address, fp(123))
        expect(await usd0.balanceOf(trade.address)).to.equal(fp(123))

        await trade.init(main.address, aliceAddr, 5, tradeReq)

        expect(await trade.canSettle()).to.be.false
        await expect(trade.settle()).to.be.reverted

        // Wait and settle the trade
        await advanceTime(5)

        expect(await trade.canSettle()).to.be.true

        // yeah, we could do this more simply with trade.connect(alice), but I'm testing spoof() too
        await main.spoof(owner.address, aliceAddr)
        await trade.settle()
        await main.unspoof(owner.address)

        // Alice now has no extra USD0 and 456 RSR.
        expect(await usd0.balanceOf(aliceAddr)).to.equal(alice_usd0_0)
        expect(await rsr.balanceOf(aliceAddr)).to.equal(fp(456).add(alice_rsr_0))
      })
    })

    it('guarantees that someTokens = tokens and someAddr = users on their shared range', async () => {
      const numTokens = await main.numTokens()
      for (let i = 0; numTokens.gt(i); i++) {
        expect(await main.tokens(i)).to.equal(await main.someToken(i))
      }
      const numUsers = await main.numUsers()
      for (let i = 0; numUsers.gt(i); i++) {
        expect(await main.users(i)).to.equal(await main.someAddr(i))
      }
    })

    it('lets users transfer tokens', async () => {
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))

      const alice_bal_init = await token.balanceOf(aliceAddr)
      const bob_bal_init = await token.balanceOf(bobAddr)

      await scenario.connect(alice).transfer(1, 0, fp(3))

      const bob_bal = await token.balanceOf(bobAddr)
      const alice_bal = await token.balanceOf(aliceAddr)

      expect(bob_bal.sub(bob_bal_init)).to.equal(3n * exa)
      expect(alice_bal_init.sub(alice_bal)).to.equal(3n * exa)
    })

    it('lets users approve and then transfer tokens', async () => {
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))

      const alice_bal_init = await token.balanceOf(aliceAddr)
      const carol_bal_init = await token.balanceOf(carolAddr)

      await scenario.connect(alice).approve(1, 0, 3n * exa)
      await scenario.connect(bob).transferFrom(0, 2, 0, 3n * exa)

      const alice_bal = await token.balanceOf(aliceAddr)
      const carol_bal = await token.balanceOf(carolAddr)

      expect(alice_bal_init.sub(alice_bal)).to.equal(3n * exa)
      expect(carol_bal.sub(carol_bal_init)).to.equal(3n * exa)
    })

    it('allows minting mutations', async () => {
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const alice_bal_init = await token.balanceOf(aliceAddr)
      await scenario.mint(0, 0, 3n * exa)
      const alice_bal = await token.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(3n * exa)
    })

    it('allows burning mutations', async () => {
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const alice_bal_init = await token.balanceOf(aliceAddr)
      await scenario.burn(0, 0, 3n * exa)
      const alice_bal = await token.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(-3n * exa)
    })

    it('allows users to try to issue rtokens without forcing approvals first', async () => {
      const alice_bal_init = await comp.rToken.balanceOf(aliceAddr)

      // Try to issue rtokens, and fail due to insufficient allowances
      await expect(scenario.connect(alice).justIssue(7n * exa)).to.be.reverted

      // As Alice, make allowances
      const [tokenAddrs, amts] = await comp.rToken.quote(7n * exa, RoundingMode.CEIL)
      for (let i = 0; i < amts.length; i++) {
        const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
        await token.connect(alice).approve(comp.rToken.address, amts[i])
      }
      // Issue RTokens and succeed
      await scenario.connect(alice).justIssue(7n * exa)
      const alice_bal = await comp.rToken.balanceOf(aliceAddr)

      expect(alice_bal.sub(alice_bal_init)).to.equal(7n * exa)
    })

    it('allows users to issue rtokens', async () => {
      const alice_bal_init = await comp.rToken.balanceOf(aliceAddr)
      await scenario.connect(alice).issue(7n * exa)
      const alice_bal = await comp.rToken.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(7n * exa)
    })

    it('allows users to cancel rtoken issuance', async () => {
      let [left, right] = await comp.rToken.idRange(aliceAddr)
      expect(right).to.equal(left)

      // 1e6 > the min block issuance limit, so this is a slow issuance
      await scenario.connect(alice).issue(1_000_000n * exa)

      // ensure that there's soemthing to cancel
      ;[left, right] = await comp.rToken.idRange(aliceAddr)
      expect(right.sub(left)).to.equal(1)

      await scenario.connect(alice).cancelIssuance(1, true)
      ;[left, right] = await comp.rToken.idRange(aliceAddr)
      expect(right).to.equal(left)
    })

    it('allows users to vest rtoken issuance', async () => {
      const alice_bal_init = await comp.rToken.balanceOf(aliceAddr)

      // As Alice, issue 1e6 rtoken
      // 1e6 > 1e5, the min block issuance limit, so this is a slow issuance
      await scenario.connect(alice).issue(1_000_000n * exa)

      // Now there are outstanding issuances
      let [left, right] = await comp.rToken.idRange(aliceAddr)
      expect(right.sub(left)).to.equal(1)

      // Wait, then vest as Alice
      // 1e6 / 1e5 == 10 blocks
      await helpers.mine(100)
      await scenario.connect(alice).vestIssuance(1)

      // Now there are no outstanding issuances
      ;[left, right] = await comp.rToken.idRange(aliceAddr)
      expect(right).to.equal(left)
      // and Alice has her tokens
      const alice_bal = await comp.rToken.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(1_000_000n * exa)
    })

    it('allows users to redeem rtokens', async () => {
      const bal0 = await comp.rToken.balanceOf(aliceAddr)

      await scenario.connect(alice).issue(7n * exa)
      const bal1 = await comp.rToken.balanceOf(aliceAddr)
      expect(bal1.sub(bal0)).to.equal(7n * exa)

      await scenario.connect(alice).redeem(5n * exa)
      const bal2 = await comp.rToken.balanceOf(aliceAddr)
      expect(bal2.sub(bal1)).to.equal(-5n * exa)

      await scenario.connect(alice).redeem(2n * exa)
      const bal3 = await comp.rToken.balanceOf(aliceAddr)
      expect(bal3.sub(bal2)).to.equal(-2n * exa)
    })

    it('lets users stake rsr', async () => {
      const rsr0 = await comp.rsr.balanceOf(aliceAddr)
      const st0 = await comp.stRSR.balanceOf(aliceAddr)

      await scenario.connect(alice).stake(5n * exa)
      const rsr1 = await comp.rsr.balanceOf(aliceAddr)
      const st1 = await comp.stRSR.balanceOf(aliceAddr)

      expect(rsr1.sub(rsr0)).to.equal(-5n * exa)
      expect(st1.sub(st0)).to.equal(5n * exa)
    })

    it('lets user stake rsr without doing the approval for them', async () => {
      const rsr0 = await comp.rsr.balanceOf(aliceAddr)

      await expect(scenario.connect(alice).justStake(5n * exa)).to.be.reverted

      await comp.rsr.connect(alice).approve(comp.stRSR.address, 5n * exa)
      await scenario.connect(alice).justStake(5n * exa)

      const rsr1 = await comp.rsr.balanceOf(aliceAddr)

      expect(rsr0.sub(rsr1)).to.equal(5n * exa)
    })

    it('lets users unstake and then withdraw rsr', async () => {
      await scenario.connect(alice).stake(5n * exa)

      await scenario.connect(alice).unstake(3n * exa)
      const rsr1 = await comp.rsr.balanceOf(aliceAddr)

      // withdraw everything available (which is nothing, because we have to wait first)
      await scenario.connect(alice).withdrawAvailable()
      expect(await comp.rsr.balanceOf(aliceAddr)).to.equal(rsr1)

      // wait
      await helpers.time.increase(await comp.stRSR.unstakingDelay())

      // withdraw everything available ( which is 3 RToken )
      await scenario.connect(alice).withdrawAvailable()
      const rsr2 = await comp.rsr.balanceOf(aliceAddr)

      expect(rsr1.add(3n * exa)).to.equal(rsr2)
    })

    it('allows general withdrawing', async () => {
      const addr = await main.someAddr(7) // be a system contract for some reason
      const acct = await ethers.getSigner(addr)
      await helpers.impersonateAccount(addr)
      await helpers.setBalance(addr, exa * exa)

      await comp.rsr.mint(addr, 100n * exa)

      const rsr0 = await comp.rsr.balanceOf(addr)
      await scenario.connect(acct).stake(99n * exa)
      const rsr1 = await comp.rsr.balanceOf(addr)
      expect(rsr1).to.equal(rsr0.sub(99n * exa))

      await scenario.connect(acct).unstake(99n * exa)
      await helpers.time.increase(await comp.stRSR.unstakingDelay())
      await scenario.connect(acct).withdrawAvailable()

      const rsr2 = await comp.rsr.balanceOf(addr)
      expect(rsr2).to.equal(rsr1.add(99n * exa))

      await helpers.stopImpersonatingAccount(addr)
    })

    it('can update asset and collateral prices', async () => {
      const numTokens = (await main.numTokens()).add(1) // add 1 to also check RSR

      // For each token other than RToken
      for (let i = 0; numTokens.gt(i); i++) {
        const token = await main.someToken(i)
        const asset = await ConAt('IAsset', await comp.assetRegistry.toAsset(token))

        // update the price twice, saving the price
        await scenario.updatePrice(i, 0, 0, 0, 0)
        const [p0Low, p0High] = await asset.price()

        await scenario.updatePrice(i, exa, exa, exa, exa)
        const [p1Low, p1High] = await asset.price()

        // if not all price models are constant, then prices p0 and p1 should be different
        if (await asset.isCollateral()) {
          const coll = await ConAt('CollateralMock', asset.address)
          const [kind0, , ,] = await coll.refPerTokModel()
          const [kind1, , ,] = await coll.targetPerRefModel()
          const [kind2, , ,] = await coll.uoaPerTargetModel()
          const [kind3, , ,] = await coll.deviationModel()
          if (kind0 == 0 && kind1 == 0 && kind2 == 0 && kind3 == 0) {
            expect(p0Low).to.equal(p1Low)
            expect(p0High).to.equal(p1High)
          } else {
            expect(p0Low).to.not.equal(p1Low)
            expect(p0High).to.not.equal(p1High)
          }
        } else {
          const assetMock = await ConAt('AssetMock', asset.address)
          const [kind, , ,] = await assetMock.model()
          if (kind == 0) {
            expect(p0Low).to.equal(p1Low)
            expect(p0High).to.equal(p1High)
          } else {
            expect(p0Low).to.not.equal(p1Low)
            expect(p0High).to.not.equal(p1High)
          }
        }
      }
    })

    it('allows the protocol to set and claim rewards', async () => {
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const r0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('RA0'))

      const rewardables = [
        comp.rTokenTrader.address,
        comp.rsrTrader.address,
        comp.backingManager.address,
        comp.rToken.address,
      ]

      // mint some c0 to each rewardable contract
      for (const r of rewardables) await c0.mint(r, exa)

      await scenario.updateRewards(0, 2n * exa) // set C0 rewards to 2exa R0

      // claim rewards for each rewardable contract, assert balance changes
      for (let i = 0; i < 4; i++) {
        const bal0 = await r0.balanceOf(rewardables[i])
        await scenario.claimRewards(i) // claim rewards
        const bal1 = await r0.balanceOf(rewardables[i])

        expect(bal1.sub(bal0)).to.equal(2n * exa)
      }

      const bal2 = await r0.balanceOf(comp.backingManager.address)
      await scenario.sweepRewards() // sweep will sweep only the rewards at rtoken.
      const bal3 = await r0.balanceOf(comp.backingManager.address)
      expect(bal3.sub(bal2)).to.equal(2n * exa)
    })

    // return a (mapping string => BigNumber)
    interface Balances {
      [key: string]: BigNumber
    }

    async function allBalances(owner: string): Promise<Balances> {
      const d: Balances = {}
      const numTokens = await main.numTokens()
      for (let i = 0; numTokens.gt(i); i++) {
        const token = await ConAt('ERC20Fuzz', await main.someToken(i))
        const sym = await token.symbol()
        d[sym] = await token.balanceOf(owner)
      }
      return d
    }

    it('can call backingManager as expected', async () => {
      // If the backing buffer is 0 and we have 100% distribution to RSR, then when some collateral
      // token is managed it is just transferred from the backing mgr to the RSR trader

      // ==== Setup: 100% distribution to RSR; backing buffer 0 (as owner => as main)
      await scenario.setBackingBuffer(0)

      expect(addrIDs.has(addr(1))).to.be.true
      expect(addrIDs.has(addr(2))).to.be.true
      const furanceID = addrIDs.get(addr(1)) as number
      const strsrID = addrIDs.get(addr(2)) as number
      expect(await main.someAddr(furanceID)).to.equal(addr(1))
      expect(await main.someAddr(strsrID)).to.equal(addr(2))
      // addr(1) == furnace, set to 0 Rtoken + 0 RSR
      await scenario.setDistribution(furanceID, 0, 0)
      // addr(2) == strsr, set to 0 Rtoken + 1 RSR
      await scenario.setDistribution(strsrID, 0, 1)

      // ==== Mint 1 exa of C0 to the backing manager
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      await c0.mint(comp.backingManager.address, exa)

      // ==== Manage C0; see that the rsrTrader balance changes for C0 and no others
      const bals0 = await allBalances(comp.rsrTrader.address)

      expect(tokenIDs.has('CA0')).to.be.true
      await scenario.pushBackingToManage(tokenIDs.get('CA0') as number)
      await scenario.manageBackingTokens()
      await scenario.popBackingToManage()

      const bals1 = await allBalances(comp.rsrTrader.address)

      for (const sym of Object.keys(bals1)) {
        const actual = bals1[sym].sub(bals0[sym])
        const expected = sym == 'CA0' ? exa : 0n
        expect(actual).to.equal(expected)
      }

      // ==== Mint and Manage CA1, RA1, and SA1;
      const round2 = ['CA1', 'RA1', 'SA1']
      for (const sym of round2) {
        const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol(sym))
        await token.mint(comp.backingManager.address, exa)
        expect(tokenIDs.has(sym)).to.be.true
        await scenario.pushBackingToManage(tokenIDs.get(sym) as number)
      }
      await scenario.manageBackingTokens()
      for (const _sym of round2) await scenario.popBackingToManage()

      // Check that the rsrTrader balance changed for C1, R1, and USD1, and no others
      const bals2 = await allBalances(comp.rsrTrader.address)

      for (const sym of Object.keys(bals2)) {
        const actual = bals2[sym].sub(bals1[sym])
        const expected = round2.includes(sym) ? exa : 0n
        expect(actual).to.equal(expected)
      }
    })

    it('can grant allownaces to RToken', async () => {
      // With token C0,
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const tokenID = tokenIDs.get('CA0') as number
      await token.mint(comp.backingManager.address, exa)

      // 1. mimic BM; set RToken's allowance to 0
      await whileImpersonating(comp.backingManager.address, async (asBM) => {
        await token.connect(asBM).approve(comp.rToken.address, 0)
      })
      const allowance0 = await token.allowance(comp.backingManager.address, comp.rToken.address)

      expect(allowance0).to.equal(0)

      // 2. grantAllowances on C0
      await scenario.grantAllowances(tokenID)
      const allowance1 = await token.allowance(comp.backingManager.address, comp.rToken.address)
      expect(allowance1).to.equal(2n ** 256n - 1n)
    })

    it('can distribute revenue (with or without forcing approvals first)', async () => {
      // ==== Setup: 100% distribution to RSR;
      const furanceID = addrIDs.get(addr(1)) as number
      const strsrID = addrIDs.get(addr(2)) as number

      // addr(1) == furnace, set to 0 Rtoken + 0 RSR
      await scenario.setDistribution(furanceID, 0, 0)
      // addr(2) == strsr, set to 0 Rtoken + 1 RSR
      await scenario.setDistribution(strsrID, 0, 1)

      const distribAddr = comp.distributor.address
      const stRSRAddr = comp.stRSR.address

      // Check balances before
      const alice_bal_init = await comp.rsr.balanceOf(aliceAddr)
      const stRSR_bal_init = await comp.rsr.balanceOf(stRSRAddr)

      expect(alice_bal_init).to.be.gt(0)
      expect(stRSR_bal_init).to.equal(0)

      // Try to distribute tokens without approval, reverts
      await expect(scenario.connect(alice).justDistributeRevenue(24, aliceAddr, 100n * exa)).to.be
        .reverted

      // As Alice, make allowance
      await comp.rsr.connect(alice).approve(distribAddr, 100n * exa)

      // Distribute as any user
      await scenario.connect(bob).justDistributeRevenue(24, 0, 100n * exa)

      // Check balances, tokens distributed to stRSR
      const alice_bal = await comp.rsr.balanceOf(aliceAddr)
      const stRSR_bal = await comp.rsr.balanceOf(stRSRAddr)
      expect(alice_bal_init.sub(alice_bal)).to.equal(100n * exa)
      expect(stRSR_bal.sub(stRSR_bal_init)).to.equal(100n * exa)

      // Can also distribute directly, forcing approval
      // It does not matter who sends the transaction,as it
      // will always make approvals as the `from` user (2nd parameter)
      await scenario.connect(carol).distributeRevenue(24, 0, 20n * exa)

      // Check new balances
      const alice_bal_end = await comp.rsr.balanceOf(aliceAddr)
      const stRSR_bal_end = await comp.rsr.balanceOf(stRSRAddr)
      expect(alice_bal.sub(alice_bal_end)).to.equal(20n * exa)
      expect(stRSR_bal_end.sub(stRSR_bal)).to.equal(20n * exa)
    })

    it('can manage tokens in Revenue Traders (RSR and RToken)', async () => {
      const furanceID = addrIDs.get(addr(1)) as number
      const strsrID = addrIDs.get(addr(2)) as number

      // RSR Trader - When RSR is the token to manage simply distribute
      // Setup: 100% distribution to RSR;
      await scenario.setDistribution(furanceID, 0, 0)
      await scenario.setDistribution(strsrID, 0, 1)

      // ==== Mint 1 exa of RSR to the RSR Trader
      await comp.rsr.mint(comp.rsrTrader.address, exa)

      const rsrTraderAddr = comp.rsrTrader.address
      const stRSRAddr = comp.stRSR.address
      const rsrTrader_bal_init = await comp.rsr.balanceOf(rsrTraderAddr)
      const stRSR_bal_init = await comp.rsr.balanceOf(stRSRAddr)

      expect(rsrTrader_bal_init).to.equal(exa)
      expect(stRSR_bal_init).to.equal(0)

      // Manage token in RSR Trader
      await scenario.manageTokenInRSRTrader(24)

      const rsrTrader_bal = await comp.rsr.balanceOf(rsrTraderAddr)
      const stRSR_bal = await comp.rsr.balanceOf(stRSRAddr)

      expect(rsrTrader_bal_init.sub(rsrTrader_bal)).to.equal(exa)
      expect(stRSR_bal.sub(stRSR_bal_init)).to.equal(exa)

      // Should work for other tokens as well
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      await c0.mint(comp.rsrTrader.address, exa)
      await expect(scenario.manageTokenInRSRTrader(0)).to.not.be.reverted

      // RToken Trader - When RToken is the token to manage simply distribute
      // Setup: 100% distribution to RToken;
      await scenario.setDistribution(furanceID, 1, 0)
      await scenario.setDistribution(strsrID, 0, 0)

      // ==== Send 1 exa of RToken to the RToken Trader
      await scenario.connect(alice).issue(exa)
      await comp.rToken.connect(alice).transfer(comp.rTokenTrader.address, exa)

      const rTokenTraderAddr = comp.rTokenTrader.address
      const furnaceAddr = comp.furnace.address
      const rTokenTrader_bal_init = await comp.rToken.balanceOf(rTokenTraderAddr)
      const furnace_bal_init = await comp.rToken.balanceOf(furnaceAddr)

      expect(rTokenTrader_bal_init).to.equal(exa)
      expect(furnace_bal_init).to.equal(0)

      // Manage token in RToken Trader
      await scenario.manageTokenInRTokenTrader(25)

      const rTokenTrader_bal = await comp.rToken.balanceOf(rTokenTraderAddr)
      const furnace_bal = await comp.rToken.balanceOf(furnaceAddr)

      expect(rTokenTrader_bal_init.sub(rTokenTrader_bal)).to.equal(exa)
      expect(furnace_bal.sub(furnace_bal_init)).to.equal(exa)

      // Should work for other tokens as well
      await c0.mint(comp.rTokenTrader.address, exa)
      await expect(scenario.manageTokenInRTokenTrader(0)).to.not.be.reverted
    })

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
      await scenario.registerAsset(7, 0, exa, exa, true, false)

      updatedErc20s = await comp.assetRegistry.erc20s()
      expect(updatedErc20s.length).to.equal(26)

      // Swap collateral in main basket - CA2 - for same type
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))
      const currentColl = await ConAt(
        'CollateralMock',
        await comp.assetRegistry.toColl(token.address)
      )

      await scenario.swapRegisteredAsset(4, 0, exa, exa, true, true)

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
      await scenario.registerAsset(7, 0, exa, exa, true, true)
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
      await scenario.registerAsset(tokenID, 0, exa, exa, true, false)

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
      expect(amts[0]).to.equal(fp('1'))
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
      expect(amts[6]).to.equal(fp('0.1'))
      expect(amts[7]).to.equal(fp('0.1'))
      expect(amts[8]).to.equal(fp('0.1'))
    })

    it('can handle freezing/pausing with roles', async () => {
      // Check initial status
      expect(await main.paused()).to.equal(false)
      expect(await main.frozen()).to.equal(false)

      //================= Pause =================
      // Attempt to pause and freeze with non-approved user
      await expect(scenario.connect(alice).pause()).to.be.reverted
      await expect(scenario.connect(bob).pause()).to.be.reverted
      await expect(scenario.connect(carol).pause()).to.be.reverted

      // Grant role PAUSER (3) to Alice
      await scenario.grantRole(3, 0)
      await scenario.connect(alice).pause()

      // Check status
      expect(await main.paused()).to.equal(true)

      // Unpause and revoke role
      await scenario.connect(alice).unpause()
      await scenario.revokeRole(3, 0)

      expect(await main.paused()).to.equal(false)

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

    it('can perform a revenue auction', async () => {
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const r0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('RA0'))

      expect(await r0.balanceOf(comp.backingManager.address)).to.equal(0)
      expect(await comp.rsr.balanceOf(comp.rsrTrader.address)).to.equal(0)

      // mint some c0 to backing manager
      await c0.mint(comp.backingManager.address, exa)

      await scenario.updateRewards(0, 20000n * exa) // set C0 rewards to 20Kexa R0

      // claim rewards
      await scenario.claimRewards(2) // claim rewards in backing manager (2)
      expect(await r0.balanceOf(comp.backingManager.address)).to.equal(20000n * exa)

      // Manage C0 and R0 in backing manager
      await scenario.pushBackingToManage(0)
      await scenario.pushBackingToManage(1)

      // Manage revenue asset in Backing Manager
      await scenario.manageBackingTokens()
      expect(await r0.balanceOf(comp.backingManager.address)).to.equal(0)
      expect(await r0.balanceOf(comp.rsrTrader.address)).to.equal(12000n * exa) // 60%
      expect(await r0.balanceOf(comp.rTokenTrader.address)).to.equal(8000n * exa) // 40%

      // Perform auction of R0
      await scenario.manageTokenInRSRTrader(1)
      expect(await r0.balanceOf(comp.rsrTrader.address)).to.equal(0)

      // Check trade
      const tradeInTrader = await ConAt('TradeMock', await comp.rsrTrader.trades(r0.address))
      const tradeInBroker = await ConAt('TradeMock', await comp.broker.lastOpenedTrade())
      expect(tradeInTrader.address).to.equal(tradeInBroker.address)

      expect(await r0.balanceOf(tradeInTrader.address)).to.equal(12000n * exa)
      expect(await tradeInTrader.status()).to.equal(TradeStatus.OPEN)
      expect(await tradeInTrader.canSettle()).to.be.false

      // Wait and settle the trade
      await advanceTime(await comp.broker.auctionLength())
      expect(await tradeInTrader.canSettle()).to.be.true

      // Manually update MarketMock seed to minBuyAmount, will provide the expected tokens
      await scenario.pushSeedForTrades(await tradeInTrader.requestedBuyAmt())

      // Settle trades
      await scenario.settleTrades()
      expect(await tradeInTrader.status()).to.equal(TradeStatus.CLOSED)

      expect(await r0.balanceOf(tradeInTrader.address)).to.equal(0)
      // Check received RSR
      expect(await comp.rsr.balanceOf(comp.rsrTrader.address)).to.be.gt(0)
    })

    it('can perform a recollateralization', async () => {
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

      // Wait, then vest as Alice
      await helpers.mine(100)
      await scenario.connect(alice).vestIssuance(1)

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

      // Manage backing tokens, will create auction
      await scenario.manageBackingTokens()

      // Check trade
      const tradeInBackingManager = await ConAt(
        'TradeMock',
        await comp.backingManager.trades(c2.address)
      )
      const tradeInBroker = await ConAt('TradeMock', await comp.broker.lastOpenedTrade())
      expect(tradeInBackingManager.address).to.equal(tradeInBroker.address)

      expect(await tradeInBackingManager.status()).to.equal(TradeStatus.OPEN)
      expect(await tradeInBackingManager.canSettle()).to.be.false

      // All defaulted tokens moved to trader
      expect(await c2.balanceOf(comp.backingManager.address)).to.equal(0)
      expect(await c2.balanceOf(tradeInBackingManager.address)).to.be.gt(0)

      // Wait and settle the trade
      await advanceTime(await comp.broker.auctionLength())
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
    expect(await scenario.callStatic.echidna_quoteProportionalToBasketIfNotRebalancing()).to.be.true
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
    expect(await scenario.callStatic.echidna_rebalancingProperties()).to.be.true
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
    // As Alice, make allowances
    const [tokenAddrs, amts] = await comp.rToken.quote(20000n * exa, RoundingMode.CEIL)
    for (let i = 0; i < amts.length; i++) {
      const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
      await token.connect(alice).approve(comp.rToken.address, amts[i])
    }
    // Issue RTokens and succeed
    await scenario.connect(alice).justIssue(20000n * exa)

    await comp.rToken.assertIssuances(aliceAddr)

    expect(await scenario.echidna_rTokenInvariants()).to.be.true
  })

  it('does not have the backingManager double-revenue bug', async () => {
    // Have some RToken in existance
    await scenario.connect(alice).issue(1e6)

    // cause C0 to grow against its ref unit
    await scenario.updatePrice(0, fp(1.1), 0, 0, fp(1))

    // call manageTokens([C0, C0])
    await scenario.pushBackingToManage(0)
    await scenario.pushBackingToManage(0)
    await expect(scenario.manageBackingTokens()).to.be.reverted
  })

  it('can manage scenario states - basket switch - covered by RSR', async () => {
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

    // Wait, then vest as Alice
    await helpers.mine(100)
    await scenario.connect(alice).vestIssuance(1)

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
    expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
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
    await expect(scenario.registerAsset(7, 0, exa, exa, true, true)).to.be.revertedWith(
      'Not valid for current state'
    )
    await expect(scenario.swapRegisteredAsset(4, 0, exa, exa, true, true)).to.be.revertedWith(
      'Not valid for current state'
    )

    let iteration = 0
    while ((await scenario.status()) == RebalancingScenarioStatus.REBALANCING_ONGOING) {
      iteration++
      // We'll check the echidna properties at each step during rebalancing...
      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Manage backing tokens, will create auction
      await scenario.manageBackingTokens()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Check trade
      const trade = await ConAt('TradeMock', await comp.broker.lastOpenedTrade())

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
      await advanceTime(await comp.broker.auctionLength())
      expect(await trade.canSettle()).to.be.true

      if (iteration == 1) {
        // No C0 tokens in backing manager
        expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

        // State remains ongoing
        expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)
      }
      // Check echidna property is true at all times in the process
      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Settle trades - set some seed > 0
      await scenario.pushSeedForTrades(fp(1000000))
      await scenario.settleTrades()

      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
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
    expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
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

    // Wait, then vest as Alice
    await helpers.mine(100)
    await scenario.connect(alice).vestIssuance(1)

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
    await expect(scenario.manageBackingTokens()).to.be.reverted

    // We are still in initial state
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.BEFORE_REBALANCING)

    // Cannot save basket range - Properties hold
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

    // Refresh basket - will perform basket switch - New basket: CA1 and CA0
    await scenario.refreshBasket()

    // Rebalancing has started
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_ONGOING)

    while ((await scenario.status()) == RebalancingScenarioStatus.REBALANCING_ONGOING) {
      // Check echidna property is true at all times in the process...
      await scenario.pushSeedForTrades(fp(100000))
      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Manage backing tokens, will create auction
      await scenario.manageBackingTokens()
      if ((await scenario.status()) != RebalancingScenarioStatus.REBALANCING_ONGOING) break

      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      await scenario.saveBasketRange()
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      expect(await comp.backingManager.tradesOpen()).to.equal(1)

      const trade = await ConAt('TradeMock', await comp.broker.lastOpenedTrade())
      expect(await trade.status()).to.equal(TradeStatus.OPEN)
      expect(await trade.canSettle()).to.be.false

      // Wait and settle the trade
      await advanceTime(await comp.broker.auctionLength())
      expect(await trade.canSettle()).to.be.true

      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true

      // Settle trades - will use previous seed > 0
      await scenario.settleTrades()

      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
      expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
      expect(await trade.status()).to.equal(TradeStatus.CLOSED)
      expect(await comp.backingManager.tradesOpen()).to.equal(0)
    }

    // Check rebalanced status...
    expect(await scenario.status()).to.equal(RebalancingScenarioStatus.REBALANCING_DONE)
    expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)
    expect(await scenario.echidna_isFullyCollateralizedAfterRebalancing()).to.be.true

    // Property noop after rebalancing, returns true. Properties hold.
    expect(await scenario.callStatic.echidna_rebalancingProperties()).to.equal(true)
    await expect(scenario.saveBasketRange()).to.be.revertedWith('Not valid for current state')
    expect(await scenario.echidna_basketRangeSmallerWhenRebalancing()).to.be.true
  })

  describe('contains the fix for the bug where', () => {
    it('manageTokens() reverting due to an invalid BU rate violates expectations', async () => {
      await scenario.connect(alice).issue(1)
      await scenario.unregisterAsset(0)
      await scenario.refreshBasket()
      expect(await scenario.callStatic.echidna_rebalancingProperties()).to.be.true
    })

    it('the rToken invariant had an underflowing index computation', async () => {
      await scenario.connect(alice).issue(20_000n * exa)
      await advanceTime(1)
      await advanceBlocks(1)
      await scenario.connect(alice).vestIssuance(1)
      expect(await scenario.callStatic.echidna_rTokenInvariants()).to.be.true
    })

    it('the quoteProportional property would fail right after a hard default', async () => {
      await scenario.connect(alice).issue(1000)
      await scenario.updatePrice(20, 0, 0, 0, 0) // reduces refPerTok and forces a hard default.
      expect(await scenario.callStatic.echidna_quoteProportionalToBasketIfNotRebalancing()).be.true
    })
  })
})
