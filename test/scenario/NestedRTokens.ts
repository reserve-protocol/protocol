// // An RToken should be able to use another RToken as backing
// describe(`An RToken that uses another RToken as backing - P${IMPLEMENTATION}`, () => {
//   beforeEach(async () => {
//     // Set up 1st RToken, which can just have a single aToken in its basket
//     // Set up 2nd RToken which consists of 2 tokens: fiatcoin + the 1st RToken
//     // Issue in the 1st RToken instance
//     // Issue in the 2nd RToken instance
//   })
//   it('should be able to chain redemptions', async () => {})
//   it('should tolerate minor changes in the price of the inner RToken during auction', async () => {})
//   it('should view donations of each other's tokens as revenue, async () => {})
// })

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { ZERO_ADDRESS, CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'
import {
  ATokenFiatCollateral,
  ERC20Mock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  RTokenCollateral,
  SelfReferentialCollateral,
  StaticATokenMock,
  OracleLib,
  TestIBackingManager,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
} from '../../typechain'
import { defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT, Collateral } from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

describe(`Nested RTokens - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Amounts
  const initialBal = bn('10000e18')
  const issueAmt = initialBal.div(100)
  let price: BigNumber

  // Tokens and Assets
  let aTokenCollateral: ATokenFiatCollateral
  let rTokenCollateral: RTokenCollateral

  // Config values
  let config: IConfig

  // First deployment
  let stRSR0: TestIStRSR
  let rsr0: ERC20Mock
  let rToken0: TestIRToken
  let assetRegistry0: IAssetRegistry
  let backingManager0: TestIBackingManager
  let basketHandler0: IBasketHandler
  let oracleLib0: OracleLib
  let rsrTrader0: TestIRevenueTrader
  let rTokenTrader0: TestIRevenueTrader
  let aaveToken0: ERC20Mock

  // Second deployment
  let stRSR1: TestIStRSR
  let rsr1: ERC20Mock
  let rToken1: TestIRToken
  let assetRegistry1: IAssetRegistry
  let backingManager1: TestIBackingManager
  let basketHandler1: IBasketHandler
  let oracleLib1: OracleLib
  let rsrTrader1: TestIRevenueTrader
  let rTokenTrader1: TestIRevenueTrader

  let loadFixture0: ReturnType<typeof createFixtureLoader>
  let loadFixture1: ReturnType<typeof createFixtureLoader>
  let wallet0: Wallet
  let wallet1: Wallet

  before('create fixture loader', async () => {
    ;[wallet0, wallet1] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture0 = createFixtureLoader([wallet0])
    loadFixture1 = createFixtureLoader([wallet1])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy two system instances -- naive destructuring fails here so we get this ugliness
    const fix0 = await loadFixture0(defaultFixture)
    stRSR0 = fix0.stRSR
    rsr0 = fix0.rsr
    rToken0 = fix0.rToken
    assetRegistry0 = fix0.assetRegistry
    backingManager0 = fix0.backingManager
    basketHandler0 = fix0.basketHandler
    oracleLib0 = fix0.oracleLib
    rsrTrader0 = fix0.rsrTrader
    rTokenTrader0 = fix0.rTokenTrader
    aaveToken0 = fix0.aaveToken

    const fix1 = await loadFixture1(defaultFixture)
    stRSR1 = fix1.stRSR
    rsr1 = fix1.rsr
    rToken1 = fix1.rToken
    assetRegistry1 = fix1.assetRegistry
    backingManager1 = fix1.backingManager
    basketHandler1 = fix1.basketHandler
    oracleLib1 = fix1.oracleLib
    rsrTrader1 = fix1.rsrTrader
    rTokenTrader1 = fix1.rTokenTrader

    // Config will be the same for both
    config = fix1.config
  })

  // this is mostly a check on our testing suite
  it('should deploy two actually different instances', async () => {
    expect(stRSR0.address).to.not.equal(stRSR1.address)
    expect(rsr0.address).to.not.equal(rsr1.address) // ideally these would be the same
    expect(rToken0.address).to.not.equal(rToken1.address)
    expect(assetRegistry0.address).to.not.equal(assetRegistry1.address)
    expect(backingManager0.address).to.not.equal(backingManager1.address)
    expect(basketHandler0.address).to.not.equal(basketHandler1.address)
    expect(oracleLib0.address).to.not.equal(oracleLib1.address)
    expect(rsrTrader0.address).to.not.equal(rsrTrader1.address)
    expect(rTokenTrader0.address).to.not.equal(rTokenTrader1.address)
  })

  context('with nesting', function () {
    beforeEach(async () => {
      const openTradingRange = {
        min: 0,
        max: config.tradingRange.max,
      }

      // Deploy ERC20s + Collateral
      const aTokenERC20 = await (
        await ethers.getContractFactory('ERC20Mock')
      ).deploy('AToken ERC20', 'AERC20')
      const staticATokenERC20 = await (
        await ethers.getContractFactory('StaticATokenMock')
      ).deploy('Static AToken ERC20', 'SAERC20', aTokenERC20.address)
      const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )
      aTokenCollateral = await (
        await ethers.getContractFactory('ATokenFiatCollateral', {
          libraries: { OracleLib: oracleLib0.address },
        })
      ).deploy(
        chainlinkFeed.address,
        staticATokenERC20.address,
        aaveToken0.address,
        openTradingRange,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT
      )
      const RTokenCollateralFactory = await ethers.getContractFactory('RTokenCollateral')
      const rTokenCollateral = await RTokenCollateralFactory.deploy(
        await rToken0.main(),
        openTradingRange,
        ethers.utils.formatBytes32String('RTK')
      )

      // Set up aToken to back RToken0
      await assetRegistry0.connect(owner).register(aTokenCollateral.address)
      await basketHandler0.connect(owner).setPrimeBasket([staticATokenERC20.address], [fp('1')])
      await basketHandler0.refreshBasket()
      await staticATokenERC20.connect(owner).mint(addr1.address, issueAmt)
      await staticATokenERC20.connect(addr1).approve(rToken0.address, issueAmt)
      await rToken0.connect(addr1).issue(issueAmt)
      expect(await rToken0.balanceOf(addr1.address)).to.equal(issueAmt)

      // Set up RToken0 to back RToken1
      await assetRegistry1.connect(owner).register(rTokenCollateral.address)
      await basketHandler1.connect(owner).setPrimeBasket([rToken0.address], [fp('1')])
      await basketHandler1.refreshBasket()
      await rToken0.connect(addr1).approve(rToken1.address, issueAmt)
      console.log(rToken0.address, rToken1.address)
      console.log(rToken1)
      await rToken1.connect(addr1).issue(issueAmt)
      console.log('1', rToken1.address, await rToken1.symbol())
      expect(await rToken1.balanceOf(addr1.address)).to.equal(issueAmt)
      console.log('2')

      // Sanity checks
      console.log(await rTokenCollateral.price())
      console.log(await basketHandler0.price())
      console.log(await rToken0.price())
      console.log(await basketHandler1.price())
      console.log(await rToken1.price())
      console.log(await basketHandler1.quote(fp('1'), 2))
      expect(await rToken0.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken1.balanceOf(addr1.address)).to.equal(issueAmt)
      expect(await rToken0.totalSupply()).to.equal(issueAmt)
      expect(await rToken1.totalSupply()).to.equal(issueAmt)
      expect(await basketHandler0.fullyCapitalized()).to.equal(true)
      expect(await basketHandler1.fullyCapitalized()).to.equal(true)
      expect(await basketHandler0.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler1.status()).to.equal(CollateralStatus.SOUND)
    })

    it('should do something', async () => {})
  })
})
