import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Wallet, Signer, BigNumber } from 'ethers'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'

import { fp } from '../../common/numbers'
import { whileImpersonating } from '../../test/utils/impersonation'
import { RoundingMode, TradeStatus, CollateralStatus } from '../../common/constants'
import { advanceBlocks, advanceTime } from '../../test/utils/time'

import * as sc from '../../typechain' // All smart contract types

import { addr } from './common'

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

describe('The Normal Operations scenario', () => {
  let scenario: sc.NormalOpsScenario
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
  describe('has mutators that', () => {
    describe('contains a mock Broker, TradingMock, and MarketMock, which...', () => {
      it('lets users trade two fiatcoins', async () => {
        const usd0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('USD0'))
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
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))

      const alice_bal_init = await token.balanceOf(aliceAddr)
      const bob_bal_init = await token.balanceOf(bobAddr)

      await scenario.connect(alice).transfer(1, 0, fp(3))

      const bob_bal = await token.balanceOf(bobAddr)
      const alice_bal = await token.balanceOf(aliceAddr)

      expect(bob_bal.sub(bob_bal_init)).to.equal(3n * exa)
      expect(alice_bal_init.sub(alice_bal)).to.equal(3n * exa)
    })

    it('lets users approve and then transfer tokens', async () => {
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))

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
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
      const alice_bal_init = await token.balanceOf(aliceAddr)
      await scenario.mint(0, 0, 3n * exa)
      const alice_bal = await token.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(3n * exa)
    })

    it('allows burning mutations', async () => {
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
      const alice_bal_init = await token.balanceOf(aliceAddr)
      await scenario.burn(0, 0, 3n * exa)
      const alice_bal = await token.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(-3n * exa)
    })

    it('allows users to try to issue rtokens without forcing approvals first', async () => {
      const alice_bal_init = await comp.rToken.balanceOf(aliceAddr)

      await warmup()

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
      await warmup()
      const alice_bal_init = await comp.rToken.balanceOf(aliceAddr)
      await scenario.connect(alice).issue(7n * exa)
      const alice_bal = await comp.rToken.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(7n * exa)
    })

    it('does not allow users to issue rtokens until warmup period is over', async () => {
      const alice_bal_init = await comp.rToken.balanceOf(aliceAddr)
      await expect(scenario.connect(alice).issue(7n * exa)).revertedWith('basket not ready')
      await warmup()
      await scenario.connect(alice).issue(7n * exa)
      const alice_bal = await comp.rToken.balanceOf(aliceAddr)
      expect(alice_bal.sub(alice_bal_init)).to.equal(7n * exa)
    })

    it('allows users to redeem rtokens', async () => {
      await warmup()
      const bal0 = await comp.rToken.balanceOf(aliceAddr)

      await scenario.connect(alice).issue(7n * exa)
      const bal1 = await comp.rToken.balanceOf(aliceAddr)
      expect(bal1.sub(bal0)).to.equal(7n * exa)

      await scenario.connect(alice).redeem(5n * exa, await comp.basketHandler.nonce())
      const bal2 = await comp.rToken.balanceOf(aliceAddr)
      expect(bal2.sub(bal1)).to.equal(-5n * exa)

      await scenario.connect(alice).redeem(2n * exa, await comp.basketHandler.nonce())
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
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
      const r0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('R0'))

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
      for (let i = 0; i < 3; i++) {
        const bal0 = await r0.balanceOf(rewardables[i])
        await scenario.claimRewards(i) // claim rewards
        const bal1 = await r0.balanceOf(rewardables[i])

        expect(bal1.sub(bal0)).to.equal(2n * exa)
      }

      const bal2 = await r0.balanceOf(comp.backingManager.address)
      expect(bal2).to.equal(2n * exa)
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
      await warmup()
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
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
      await c0.mint(comp.backingManager.address, exa)

      // ==== Manage C0; see that the rsrTrader balance changes for C0 and no others
      const bals0 = await allBalances(comp.rsrTrader.address)

      expect(tokenIDs.has('C0')).to.be.true
      await scenario.pushBackingToManage(tokenIDs.get('C0') as number)
      await scenario.manageBackingTokens()
      await scenario.popBackingToManage()

      const bals1 = await allBalances(comp.rsrTrader.address)

      for (const sym of Object.keys(bals1)) {
        const actual = bals1[sym].sub(bals0[sym])
        const expected = sym == 'C0' ? exa : 0n
        expect(actual).to.equal(expected)
      }

      // ==== Mint and Manage C1, R1, and USD1;
      const round2 = ['C1', 'R1', 'USD1']
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
      const token = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
      const tokenID = tokenIDs.get('C0') as number
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

    it('can distribute revenue', async () => {
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
      await expect(scenario.connect(alice).justDistributeRevenue(8, 0, 100n * exa)).to.be.reverted

      // As Alice, make allowance
      await comp.rsr.connect(alice).approve(distribAddr, 100n * exa)

      // Distribute as any user
      await scenario.connect(alice).justDistributeRevenue(8, 0, 100n * exa)

      // Check balances, tokens distributed to stRSR
      const alice_bal = await comp.rsr.balanceOf(aliceAddr)
      const stRSR_bal = await comp.rsr.balanceOf(stRSRAddr)
      expect(alice_bal_init.sub(alice_bal)).to.equal(100n * exa)
      expect(stRSR_bal.sub(stRSR_bal_init)).to.equal(100n * exa)

      // Can also distribute directly, forcing approval
      // It does not matter who sends the transaction,as it
      // will always make approvals as the `from` user (2nd parameter)
      await scenario.connect(alice).distributeRevenue(8, 0, 20n * exa)

      // Check new balances
      const alice_bal_end = await comp.rsr.balanceOf(aliceAddr)
      const stRSR_bal_end = await comp.rsr.balanceOf(stRSRAddr)
      expect(alice_bal.sub(alice_bal_end)).to.equal(20n * exa)
      expect(stRSR_bal_end.sub(stRSR_bal)).to.equal(20n * exa)
    })

    it('can manage tokens in Revenue Traders (RSR and RToken)', async () => {
      await warmup()
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
      await scenario.manageTokenInRSRTrader(8)

      const rsrTrader_bal = await comp.rsr.balanceOf(rsrTraderAddr)
      const stRSR_bal = await comp.rsr.balanceOf(stRSRAddr)

      expect(rsrTrader_bal_init.sub(rsrTrader_bal)).to.equal(exa)
      expect(stRSR_bal.sub(stRSR_bal_init)).to.equal(exa)

      // Should work for other tokens as well
      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
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
      await scenario.manageTokenInRTokenTrader(9)

      const rTokenTrader_bal = await comp.rToken.balanceOf(rTokenTraderAddr)
      const furnace_bal = await comp.rToken.balanceOf(furnaceAddr)

      expect(rTokenTrader_bal_init.sub(rTokenTrader_bal)).to.equal(exa)
      expect(furnace_bal.sub(furnace_bal_init)).to.equal(exa)

      // Should work for other tokens as well
      await c0.mint(comp.rTokenTrader.address, exa)
      await expect(scenario.manageTokenInRTokenTrader(0)).to.not.be.reverted
    })

    it('can perform a revenue auction', async () => {
      await warmup()

      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('C0'))
      const r0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('R0'))

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
