import { expect, assert } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, Wallet } from 'ethers'

import { fp } from '../../common/numbers'
import { ZERO_ADDRESS, OWNER } from '../../common/constants'
import * as sc from '../../typechain' // All smart contract types

import { PriceModelKind, PriceModel, CONFIG } from './common'

const OneShotFreezeDuration = 1209600 // 2 weeks

describe('TradeMock', () => {
  let main: sc.MainP1Fuzz
  let rsr: sc.ERC20Mock
  let rtoken: sc.RTokenP1Fuzz
  let usda: sc.ERC20Mock
  let market: sc.MarketMock
  let broker: sc.BrokerP1Fuzz

  let trade: sc.TradeMock

  let owner: Wallet

  before('Get signers', async () => {
    ;[owner] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach('Deploy contracts', async () => {
    const F = ethers.getContractFactory
    const mainFactory: sc.MainP1Fuzz__factory = await F('MainP1Fuzz')
    const brokerFactory: sc.BrokerP1Fuzz__factory = await F('BrokerP1Fuzz')
    const rtokenFactory: sc.RTokenP1Fuzz__factory = await F('RTokenP1Fuzz')
    const erc20Factory: sc.ERC20Mock__factory = await F('ERC20Mock')
    const tradeFactory: sc.TradeMock__factory = await F('TradeMock')
    const marketFactory: sc.MarketMock__factory = await F('MarketMock')

    main = await mainFactory.deploy()

    rsr = await erc20Factory.deploy('Reserve Rights', 'RSR')
    usda = await erc20Factory.deploy('Token Alpha', 'USDA')

    rtoken = await rtokenFactory.deploy()
    market = await marketFactory.deploy(main.address)
    broker = await brokerFactory.deploy()
    trade = await tradeFactory.deploy()

    let components = ZERO_COMPONENTS
    components.rToken = rtoken.address
    components.broker = broker.address
    await main.initForFuzz(components, rsr.address, OneShotFreezeDuration, market.address)

    await main.setSender(owner.address)
    await broker.init(main.address, ZERO_ADDRESS, trade.address, CONFIG.auctionLength)
    await rtoken.init(main.address, 'Reserve', 'R', 'sometimes I just sits', CONFIG.issuanceRate)
    await main.setSender(ZERO_ADDRESS)
  })

  it('test setup worked', async () => {
    for (let comp of [main, rsr, rtoken, usda, market, broker, trade]) {
      assert.isOk(comp)
      assert.isOk(comp.address)
      assert.isString(comp.address)
    }
    expect(await main.rToken()).to.equal(rtoken.address)
    expect(await main.broker()).to.equal(broker.address)
  })

  it('can trade two tokens at a specified rate')
})
