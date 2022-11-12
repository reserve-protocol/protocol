import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'
import {
  ERC20Mock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  SelfReferentialCollateral,
  TestIBackingManager,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
  WETH9,
} from '../../typechain'
import { defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'

const createFixtureLoader = waffle.createFixtureLoader
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe(`Linear combination of self-referential collateral - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Amounts
  const initialBal = bn('10000e18')
  const issueAmt = initialBal.div(100)
  let price: BigNumber

  // Tokens and Assets
  let token0: WETH9
  let collateral0: SelfReferentialCollateral
  let token1: ERC20Mock
  let collateral1: SelfReferentialCollateral
  let token2: ERC20Mock
  let collateral2: SelfReferentialCollateral

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      stRSR,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      rTokenTrader,
      rsrTrader,
    } = await loadFixture(defaultFixture))

    await backingManager.connect(owner).setBackingBuffer(0)

    const SelfReferentialFactory = await ethers.getContractFactory('SelfReferentialCollateral')
    const ChainlinkFeedFactory = await ethers.getContractFactory('MockV3Aggregator')

    // WETH against ETH
    token0 = await (await ethers.getContractFactory('WETH9')).deploy()
    let chainlinkFeed = <MockV3Aggregator>await ChainlinkFeedFactory.deploy(8, bn('1e8'))
    collateral0 = await SelfReferentialFactory.deploy(
      fp('1'),
      chainlinkFeed.address,
      token0.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('ETH'),
      DELAY_UNTIL_DEFAULT
    )

    // MKR against MKR
    token1 = await (await ethers.getContractFactory('ERC20Mock')).deploy('MKR Token', 'MKR')
    chainlinkFeed = <MockV3Aggregator>await ChainlinkFeedFactory.deploy(8, bn('2e8'))
    collateral1 = await SelfReferentialFactory.deploy(
      fp('2'),
      chainlinkFeed.address,
      token1.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('MKR'),
      DELAY_UNTIL_DEFAULT
    )

    // COMP against COMP
    token2 = await (await ethers.getContractFactory('ERC20Mock')).deploy('COMP Token', 'COMP')
    chainlinkFeed = <MockV3Aggregator>await ChainlinkFeedFactory.deploy(8, bn('4e8'))
    collateral2 = await SelfReferentialFactory.deploy(
      fp('4'),
      chainlinkFeed.address,
      token2.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('COMP'),
      DELAY_UNTIL_DEFAULT
    )

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(collateral1.address)
    await assetRegistry.connect(owner).register(collateral2.address)
    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(token1.address)
    await backingManager.grantRTokenAllowance(token2.address)
    await basketHandler.setPrimeBasket(
      [token0.address, token1.address, token2.address],
      [fp('1'), fp('3'), fp('9')] // powers of 3
    )
    await basketHandler.refreshBasket()

    // Mint initial balances
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)

    // Deposit ETH to get WETH for token0
    await token0.connect(addr1).deposit({
      value: ethers.utils.parseUnits(issueAmt.toString(), 'wei'),
    })

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)

    // Approve and issue
    await token0.connect(addr1).approve(rToken.address, issueAmt)
    await token1.connect(addr1).approve(rToken.address, issueAmt.mul(3))
    await token2.connect(addr1).approve(rToken.address, issueAmt.mul(9))
    await rToken.connect(addr1).issue(issueAmt)

    // Verify balances
    expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmt)
    expect(await token1.balanceOf(backingManager.address)).to.equal(issueAmt.mul(3))
    expect(await token2.balanceOf(backingManager.address)).to.equal(issueAmt.mul(9))
    expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)

    price = fp('9')
      .mul(bn('4'))
      .add(fp('3').mul(bn('2')))
      .add(fp('1').mul(bn('1')))
  })

  it('should not produce revenue', async () => {
    const [isFallback, price_] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    expect(price_).to.equal(price)
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    await expectEvents(
      backingManager
        .connect(owner)
        .manageTokens([
          token0.address,
          token1.address,
          token2.address,
          rsr.address,
          rToken.address,
        ]),
      [
        {
          contract: backingManager,
          name: 'TradeStarted',
          emitted: false,
        },
        {
          contract: token0,
          name: 'Transfer',
          emitted: false,
        },
        {
          contract: token1,
          name: 'Transfer',
          emitted: false,
        },
        {
          contract: token2,
          name: 'Transfer',
          emitted: false,
        },
        {
          contract: rsr,
          name: 'Transfer',
          emitted: false,
        },
        {
          contract: rToken,
          name: 'Transfer',
          emitted: false,
        },
      ]
    )
    const [isFallback2, price2] = await basketHandler.price(true)
    expect(isFallback2).to.equal(false)
    expect(price2).to.equal(price)
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
  })

  it('should not change basket after price movements', async () => {
    // Halve all prices
    await setOraclePrice(collateral0.address, bn('1e8').div(2))
    await setOraclePrice(collateral1.address, bn('2e8').div(2))
    await setOraclePrice(collateral2.address, bn('4e8').div(2))
    const [isFallback, price_] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    expect(price_).to.equal(price.div(2))

    // Redeem
    await rToken.connect(addr1).redeem(issueAmt)
    expect(await token0.balanceOf(backingManager.address)).to.equal(0)
    expect(await token1.balanceOf(backingManager.address)).to.equal(0)
    expect(await token2.balanceOf(backingManager.address)).to.equal(0)
    expect(await rToken.balanceOf(addr1.address)).to.equal(0)

    // Re-issue
    await token0.connect(addr1).approve(rToken.address, issueAmt)
    await token1.connect(addr1).approve(rToken.address, issueAmt.mul(3))
    await token2.connect(addr1).approve(rToken.address, issueAmt.mul(9))
    await rToken.connect(addr1).issue(issueAmt)

    // Verify balances
    expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmt)
    expect(await token1.balanceOf(backingManager.address)).to.equal(issueAmt.mul(3))
    expect(await token2.balanceOf(backingManager.address)).to.equal(issueAmt.mul(9))
    expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)
  })

  it('should discover revenue when altruists/idiots donate', async () => {
    await token1.connect(owner).mint(backingManager.address, issueAmt.mul(3)) // double balance of token1
    const amtToRToken = issueAmt.mul(3).mul(2).div(5)
    const amtToStRSR = issueAmt.mul(3).mul(3).div(5)

    // Should send donated token to revenue traders
    await expectEvents(
      backingManager.manageTokens([
        token0.address,
        token1.address,
        token2.address,
        rsr.address,
        rToken.address,
      ]),
      [
        {
          contract: token1,
          name: 'Transfer',
          args: [backingManager.address, rTokenTrader.address, amtToRToken],
          emitted: true,
        },
        {
          contract: token1,
          name: 'Transfer',
          args: [backingManager.address, rsrTrader.address, amtToStRSR],
          emitted: true,
        },
      ]
    )
  })
})
