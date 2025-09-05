import { ethers } from 'hardhat'
import { Signer, Wallet } from 'ethers'
import fuzzTests from './commonTests'
import { NormalOpsScenario } from '@typechain/NormalOpsScenario'
import { MainP1Fuzz } from '@typechain/MainP1Fuzz'
import {
  impersonateAccount,
  loadFixture,
  mine,
  setBalance,
} from '@nomicfoundation/hardhat-network-helpers'
import { advanceBlocks, advanceTime } from '../utils/time'
import { expect } from 'chai'
import { CollateralStatus } from '../plugins/individual-collateral/pluginTestTypes'
import { whileImpersonating } from '../utils/impersonation'
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

type Fixture<T> = () => Promise<T>

const createFixture: Fixture<FuzzTestFixture> = async () => {
  let scenario: NormalOpsScenario
  let main: MainP1Fuzz
  let comp: Components

  let owner: Wallet
  let alice: Signer
  let bob: Signer
  let carol: Signer

  let aliceAddr: string
  let bobAddr: string
  let carolAddr: string

  let collaterals: string[] = ['C0', 'C1', 'C2']
  let rewards: string[] = ['R0', 'R1']
  let stables: string[] = ['USD0', 'USD1', 'USD2']

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
  let scenario: NormalOpsScenario
  let main: MainP1Fuzz
  let comp: Components
  let alice: Signer
  let tokenIDs: Map<string, number>
  let warmup: () => void

  beforeEach(async () => {
    const f = await loadFixture(createFixture)
    scenario = f.scenario as NormalOpsScenario
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

    expect(await comp.basketHandler.enableIssuancePremium()).to.equal(true)
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
      await expect(scenario.forwardRevenue()).to.be.reverted

      expect(await scenario.echidna_isFullyCollateralized()).to.be.true
    })

    it('stRSR tries to pay revenue to no stakers', async () => {
      await comp.rsr.mint(comp.rsrTrader.address, exa)
      await advanceTime(600000)
      await scenario.distributeTokenToBuy(0)
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
      await comp.rsr.mint(comp.rsrTrader.address, exa)
      await advanceTime(410_000)
      await scenario.distributeTokenToBuy(0) // Distribute 50 atto RSR from alice
      await advanceTime(410_000)
      await scenario.connect(alice).stake(1)
      await advanceTime(410_000)
      await scenario.connect(alice).unstake(1)

      expect(await scenario.callStatic.echidna_ratesNeverFall()).to.be.true
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

    it('rate falling after all RTokens are redeemed or melted - rate resets to 1:1 peg', async () => {
      await warmup()
      await scenario.connect(alice).issueTo(604799, 47)
      await advanceTime(327047)
      await advanceBlocks(23076)
      await scenario.connect(alice).setFurnaceRatio(18248413350069832992807152334633706987539065233203193224088588905331626303174n)
      await advanceTime(72098)
      await advanceBlocks(290)
      await scenario.connect(alice).payRTokenProfits()
      await advanceTime(122492)
      await advanceBlocks(967)
      await advanceTime(436402)
      await advanceBlocks(39250)
      await advanceTime(603284)
      await advanceBlocks(31565)
      await advanceTime(516218)
      await advanceBlocks(35733)
      await advanceTime(350417)
      await advanceBlocks(34610)
      await advanceTime(152267)
      await advanceBlocks(255)
      await advanceTime(429839)
      await advanceBlocks(40578)
      await scenario.connect(alice).payRSRProfits()
      await advanceTime(263005)
      await advanceBlocks(8805)
      await advanceTime(458483)
      await advanceBlocks(23119)
      await scenario.connect(alice).saveRates()
      await advanceTime(196550)
      await advanceBlocks(28586)
      await advanceTime(527990)
      await advanceBlocks(13610)
      await advanceTime(569993)
      await advanceBlocks(49950)
      await advanceTime(444311)
      await advanceBlocks(150)
      await scenario.connect(alice).payRTokenProfits() // all is melted
      expect(await scenario.callStatic.echidna_ratesNeverFall()).to.be.true
    })
  })
  }

const context: FuzzTestContext<FuzzTestFixture> = {
    f: createFixture,
    testType: 'Normal',
    scenarioSpecificTests,
  }

  fuzzTests(context)
