import { expect } from 'chai'
import { ethers } from 'hardhat'

import { fp } from '../../common/numbers'
import { whileImpersonating } from '../../test/utils/impersonation'
import { advanceTime, advanceBlocks } from '../../test/utils/time'

import * as sc from '../../typechain' // All smart contract types

import { addr } from './common'

const user = (i: number) => addr((i + 1) * 0x10000)
const ConAt = ethers.getContractAt

const componentsOf = async (main: sc.IMain) => ({
  rsr: await ConAt('ERC20Mock', await main.rsr()),
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

describe('Basic Scenario with FuzzP1', () => {
  let scenario: sc.BasicP1Scenario
  let main: sc.MainP1Fuzz
  let comp: Components

  beforeEach('Deploy Scenario', async () => {
    const F = ethers.getContractFactory
    const scenarioFactory: sc.BasicP1Scenario__factory = await F('BasicP1Scenario')

    // {gas
    scenario = await scenarioFactory.deploy({ gasLimit: 0x1ffffffff })
    main = await ethers.getContractAt('MainP1Fuzz', await scenario.main())
    comp = await componentsOf(main)
  })

  it('deploys as intended', async () => {
    // users
    expect(await main.numUsers()).to.equal(3)
    expect(await main.users(0)).to.equal(user(0))
    expect(await main.users(1)).to.equal(user(1))
    expect(await main.users(2)).to.equal(user(2))

    // tokens and user balances
    expect(await main.numTokens()).to.equal(6)
    for (let t = 0; t < 6; t++) {
      const token = await ethers.getContractAt('ERC20Mock', await main.tokens(t))
      const sym = t < 3 ? 'C' + t : 'USD' + (t - 3)
      expect(await token.symbol()).to.equal(sym)

      for (let u = 0; u < 3; u++) {
        expect(await token.balanceOf(user(u))).to.equal(fp(1e6))
      }
    }

    for (let u = 0; u < 3; u++) {
      expect(await comp.rsr.balanceOf(user(u))).to.equal(fp(1e6))
    }

    // assets and collateral
    const erc20s = await comp.assetRegistry.erc20s()
    expect(erc20s.length).to.equal(8)
    for (const erc20 of erc20s) {
      if (erc20 === comp.rToken.address) await comp.assetRegistry.toAsset(erc20)
      else if (erc20 === comp.rsr.address) await comp.assetRegistry.toAsset(erc20)
      else await comp.assetRegistry.toColl(erc20)
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

  it('allows basic issuance and redemption', async () => {
    const alice = user(0)
    await scenario.startIssue()
    expect(await comp.rToken.balanceOf(alice)).to.equal(0)

    await advanceBlocks(100)
    await scenario.finishIssue()
    expect(await comp.rToken.balanceOf(alice)).to.equal(fp(1e6))

    await scenario.redeem()
    expect(await comp.rToken.balanceOf(alice)).to.equal(0)
  })

  it('BackingManager can buy RTokens in trade', async () => {
    const usda = await ConAt('ERC20Mock', await main.tokens(3))
    const bm_addr = comp.backingManager.address

    // BackingMgr starts with 123 USDA
    await usda.mint(bm_addr, fp(123))
    expect(await usda.balanceOf(bm_addr)).to.equal(fp(123))
    expect(await comp.rToken.balanceOf(bm_addr)).to.equal(0)

    // BackingMgr sends 123 USDA to the trade
    await whileImpersonating(bm_addr, async (signer) => {
      await usda.connect(signer).approve(comp.broker.address, fp(123))
    })

    const rtoken_asset = await comp.assetRegistry.toAsset(comp.rToken.address)
    const usda_asset = await comp.assetRegistry.toAsset(usda.address)

    // Init the trade
    const tradeReq = {
      buy: rtoken_asset,
      sell: usda_asset,
      minBuyAmount: fp(456),
      sellAmount: fp(123),
    }

    await main.setSender(bm_addr)
    await comp.broker.openTrade(tradeReq)

    // Wait and settle the trade
    await advanceTime(5)

    await comp.broker.settleTrades()
    await main.setSender(addr(0))

    // BackingMgr now has no USDA and 456 rToken.
    expect(await usda.balanceOf(bm_addr)).to.equal(0)
    expect(await comp.rToken.balanceOf(bm_addr)).to.equal(fp(456))
  })
})
