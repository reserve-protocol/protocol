import { expect, assert } from 'chai'
import { ethers } from 'hardhat'
import { Wallet } from 'ethers'

import { fp } from '../../common/numbers'
import { ZERO_ADDRESS } from '../../common/constants'
import { whileImpersonating } from '../../test/utils/impersonation'
import { advanceTime } from '../../test/utils/time'

import * as sc from '../../typechain' // All smart contract types

import { CONFIG, onePM, ZERO_COMPONENTS } from './common'

const OneShotFreezeDuration = 1209600 // 2 weeks

describe('TradeMock', () => {
  let main: sc.MainP1Fuzz
  let rsr: sc.ERC20Mock
  let rtoken: sc.RTokenP1Fuzz
  let usda: sc.ERC20Mock
  let market: sc.MarketMock
  let broker: sc.BrokerP1Fuzz

  let rsrAsset: sc.AssetMock
  let usdaAsset: sc.AssetMock
  let rtokenAsset: sc.AssetMock

  let trade: sc.TradeMock

  let owner: Wallet
  let alice: Wallet

  before('Get signers', async () => {
    ;[owner, alice] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach('Deploy contracts', async () => {
    const F = ethers.getContractFactory
    const mainFactory: sc.MainP1Fuzz__factory = await F('MainP1Fuzz')
    const brokerFactory: sc.BrokerP1Fuzz__factory = await F('BrokerP1Fuzz')
    const rtokenFactory: sc.RTokenP1Fuzz__factory = await F('RTokenP1Fuzz')
    const erc20Factory: sc.ERC20Mock__factory = await F('ERC20Mock')
    const tradeFactory: sc.TradeMock__factory = await F('TradeMock')
    const marketFactory: sc.MarketMock__factory = await F('MarketMock')
    const assetFactory: sc.AssetMock__factory = await F('AssetMock')

    main = await mainFactory.deploy()

    rsr = await erc20Factory.deploy('Reserve Rights', 'RSR')
    usda = await erc20Factory.deploy('Token Alpha', 'USDA')

    rtoken = await rtokenFactory.deploy()
    market = await marketFactory.deploy(main.address)
    broker = await brokerFactory.deploy()
    trade = await tradeFactory.deploy()

    rsrAsset = await assetFactory.deploy(rsr.address, fp('1e18'), onePM)
    usdaAsset = await assetFactory.deploy(usda.address, fp('1e18'), onePM)
    rtokenAsset = await assetFactory.deploy(rtoken.address, fp('1e18'), onePM)

    const components = ZERO_COMPONENTS
    components.rToken = rtoken.address
    components.broker = broker.address
    await main.initForFuzz(components, rsr.address, OneShotFreezeDuration, market.address)

    await main.setSender(owner.address)
    await broker.init(main.address, ZERO_ADDRESS, trade.address, CONFIG.auctionLength)
    await rtoken.init(main.address, 'Reserve', 'R', 'sometimes I just sits', CONFIG.issuanceRate)
    await main.setSender(ZERO_ADDRESS)
  })

  it('test setup worked', async () => {
    for (const comp of [main, rsr, rtoken, usda, market, broker, trade]) {
      assert.isOk(comp)
      assert.isOk(comp.address)
      assert.isString(comp.address)
    }
    expect(await main.rToken()).to.equal(rtoken.address)
    expect(await main.broker()).to.equal(broker.address)
  })

  it('can trade two tokens', async () => {
    // Alice starts with 123 USDA
    await usda.mint(alice.address, fp(123))
    expect(await usda.balanceOf(alice.address)).to.equal(fp(123))
    expect(await rsr.balanceOf(alice.address)).to.equal(0)

    // Alice sends 123 USDA to the trade
    await whileImpersonating(alice.address, async (signer) => {
      await usda.connect(signer).transfer(trade.address, fp(123))
    })

    // Init the trade
    const tradeReq = {
      buy: rsrAsset.address,
      sell: usdaAsset.address,
      minBuyAmount: fp(456),
      sellAmount: fp(123),
    }
    await trade.init(main.address, alice.address, 5, tradeReq)

    expect(await trade.canSettle()).to.be.false
    await whileImpersonating(alice.address, async (signer) => {
      await expect(trade.connect(signer).settle()).to.be.reverted
    })

    // Wait and settle the trade
    await advanceTime(5)

    expect(await trade.canSettle()).to.be.true
    await whileImpersonating(alice.address, async (signer) => {
      await trade.connect(signer).settle()
    })

    // Alice now has no USDA and 456 RSR.
    expect(await usda.balanceOf(alice.address)).to.equal(0)
    expect(await rsr.balanceOf(alice.address)).to.equal(fp(456))
  })
})
