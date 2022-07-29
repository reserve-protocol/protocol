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
import { Fixture } from 'ethereum-waffle'
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
import {
  defaultFixture,
  DefaultFixture,
  IMPLEMENTATION,
  ORACLE_TIMEOUT,
  Collateral,
} from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

interface DualFixture {
  one: DefaultFixture
  two: DefaultFixture
}

const dualFixture: Fixture<DualFixture> = async function ([owner]): Promise<DualFixture> {
  return {
    one: await createFixtureLoader([owner])(defaultFixture),
    two: await createFixtureLoader([owner])(defaultFixture),
  }
}

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

  // Whole system instances
  let one: DefaultFixture
  let two: DefaultFixture

  let loadFixtureDual: ReturnType<typeof createFixtureLoader>

  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixtureDual = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ one, two } = await loadFixtureDual(dualFixture))
  })

  // this is mostly a check on our testing suite
  it('should deploy two actually different instances', async () => {
    expect(one.stRSR.address).to.not.equal(two.stRSR.address)
    expect(one.rsr.address).to.not.equal(two.rsr.address) // ideally these would be the same
    expect(one.rToken.address).to.not.equal(two.rToken.address)
    expect(one.assetRegistry.address).to.not.equal(two.assetRegistry.address)
    expect(one.backingManager.address).to.not.equal(two.backingManager.address)
    expect(one.basketHandler.address).to.not.equal(two.basketHandler.address)
    expect(one.oracleLib.address).to.not.equal(two.oracleLib.address)
    expect(one.rsrTrader.address).to.not.equal(two.rsrTrader.address)
    expect(one.rTokenTrader.address).to.not.equal(two.rTokenTrader.address)
  })

  context('with nesting', function () {
    beforeEach(async () => {
      const openTradingRange = {
        min: 0,
        max: one.config.tradingRange.max,
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
          libraries: { OracleLib: one.oracleLib.address },
        })
      ).deploy(
        chainlinkFeed.address,
        staticATokenERC20.address,
        one.aaveToken.address,
        openTradingRange,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT
      )
      const RTokenCollateralFactory = await ethers.getContractFactory('RTokenCollateral')
      const rTokenCollateral = await RTokenCollateralFactory.deploy(
        await one.rToken.main(),
        openTradingRange,
        ethers.utils.formatBytes32String('RTK')
      )

      // Set up aToken to back RToken0
      await one.assetRegistry.connect(owner).register(aTokenCollateral.address)
      await one.basketHandler.connect(owner).setPrimeBasket([staticATokenERC20.address], [fp('1')])
      await one.basketHandler.refreshBasket()
      await staticATokenERC20.connect(owner).mint(addr1.address, issueAmt)
      await staticATokenERC20.connect(addr1).approve(one.rToken.address, issueAmt)
      await one.rToken.connect(addr1).issue(issueAmt)
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Set up RToken0 to back RToken1
      await two.assetRegistry.connect(owner).register(rTokenCollateral.address)
      await two.basketHandler.connect(owner).setPrimeBasket([one.rToken.address], [fp('1')])
      await two.basketHandler.refreshBasket()
      await one.rToken.connect(addr1).approve(two.rToken.address, issueAmt)
      await two.rToken.connect(addr1).issue(issueAmt)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(issueAmt)
    })

    it('should pass sanity checks', async () => {
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(issueAmt)
      expect(await one.rToken.totalSupply()).to.equal(issueAmt)
      expect(await two.rToken.totalSupply()).to.equal(issueAmt)
      expect(await one.basketHandler.fullyCapitalized()).to.equal(true)
      expect(await two.basketHandler.fullyCapitalized()).to.equal(true)
      expect(await one.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})
