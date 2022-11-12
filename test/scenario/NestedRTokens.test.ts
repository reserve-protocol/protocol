import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Fixture } from 'ethereum-waffle'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { ZERO_ADDRESS, CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { setOraclePrice } from '../utils/oracles'
import { advanceTime } from '../utils/time'
import { expectEvents } from '../../common/events'
import {
  ATokenFiatCollateral,
  MockV3Aggregator,
  StaticATokenMock,
  RTokenCollateral,
} from '../../typechain'
import { defaultFixture, DefaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'

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

  // Tokens and Assets
  let aTokenCollateral: ATokenFiatCollateral
  let staticATokenERC20: StaticATokenMock
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
      // Deploy ERC20s + Collateral
      const aTokenERC20 = await (
        await ethers.getContractFactory('ERC20Mock')
      ).deploy('AToken ERC20', 'AERC20')
      staticATokenERC20 = await (
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
        fp('1'),
        chainlinkFeed.address,
        staticATokenERC20.address,
        one.config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT
      )
      const RTokenCollateralFactory = await ethers.getContractFactory('RTokenCollateral')
      rTokenCollateral = await RTokenCollateralFactory.deploy(
        one.rToken.address,
        one.config.rTokenMaxTradeVolume,
        ethers.utils.formatBytes32String('RTK'),
        DELAY_UNTIL_DEFAULT
      )

      // Set up aToken to back RToken0 and issue
      await one.assetRegistry.connect(owner).register(aTokenCollateral.address)
      await one.basketHandler.connect(owner).setPrimeBasket([staticATokenERC20.address], [fp('1')])
      await one.basketHandler.refreshBasket()
      await staticATokenERC20.connect(owner).mint(addr1.address, issueAmt)
      await staticATokenERC20.connect(addr1).approve(one.rToken.address, issueAmt)
      await one.rToken.connect(addr1).issue(issueAmt)
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Set up RToken0 to back RToken1 and issue
      await two.assetRegistry.connect(owner).register(rTokenCollateral.address)
      await two.basketHandler.connect(owner).setPrimeBasket([one.rToken.address], [fp('1')])
      await two.basketHandler.refreshBasket()
      await one.rToken.connect(addr1).approve(two.rToken.address, issueAmt)
      await two.rToken.connect(addr1).issue(issueAmt)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Grant allowances
      await one.backingManager.grantRTokenAllowance(staticATokenERC20.address)
      await two.backingManager.grantRTokenAllowance(one.rToken.address)

      // Stake -- remember we have different RSRs
      await one.rsr.connect(owner).mint(addr1.address, initialBal)
      await two.rsr.connect(owner).mint(addr1.address, initialBal)
      await one.rsr.connect(addr1).approve(one.stRSR.address, initialBal)
      await two.rsr.connect(addr1).approve(two.stRSR.address, initialBal)
      await one.stRSR.connect(addr1).stake(issueAmt)
      await two.stRSR.connect(addr1).stake(issueAmt)

      // Set backing buffers
      await one.backingManager.setBackingBuffer(0)
      await two.backingManager.setBackingBuffer(0)
    })

    it('should pass sanity checks', async () => {
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(issueAmt)
      expect(await one.rToken.totalSupply()).to.equal(issueAmt)
      expect(await two.rToken.totalSupply()).to.equal(issueAmt)
      expect(await one.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await one.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
    })

    it('should be able to wind down the dual RToken structure', async () => {
      // Redeem everything
      expect(await staticATokenERC20.balanceOf(addr1.address)).to.equal(0)
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(issueAmt)
      await two.rToken.connect(addr1).redeem(issueAmt)
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(issueAmt)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(0)
      await one.rToken.connect(addr1).redeem(issueAmt)
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await two.rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await one.rToken.totalSupply()).to.equal(0)
      expect(await one.rToken.totalSupply()).to.equal(0)
      expect(await staticATokenERC20.balanceOf(addr1.address)).to.equal(issueAmt)

      // BasketHandler checks
      expect(await one.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
    })

    it('should tolerate changes in the price of the inner RToken during auction', async () => {
      // Burn half the backing in the inner RToken
      await staticATokenERC20.connect(owner).burn(one.backingManager.address, issueAmt.div(2))
      expect(await one.basketHandler.fullyCollateralized()).to.equal(false)
      expect(await one.basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Verify outer RToken isn't panicking
      await two.assetRegistry.refresh()
      expect(await two.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await expect(two.backingManager.manageTokens([])).to.not.emit(
        two.backingManager,
        'TradeStarted'
      )

      // Launch recollateralization auction in inner RToken
      const buyAmt = issueAmt.div(2)
      const sellAmt = buyAmt.mul(100).div(99).add(1)
      await expect(one.backingManager.manageTokens([]))
        .to.emit(one.backingManager, 'TradeStarted')
        .withArgs(anyValue, one.rsr.address, staticATokenERC20.address, sellAmt, buyAmt)

      // Verify outer RToken isn't panicking
      await two.assetRegistry.refresh()
      expect(await two.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await expect(two.backingManager.manageTokens([])).to.not.emit(
        two.backingManager,
        'TradeStarted'
      )

      // Prices should be aware
      expect(await one.rTokenAsset.strictPrice()).to.be.closeTo(fp('0.99'), fp('0.001'))
      expect(await rTokenCollateral.strictPrice()).to.be.closeTo(fp('0.99'), fp('0.001'))
    })

    it("should view donations of the other's RToken as revenue", async () => {
      // Issue
      await staticATokenERC20.connect(owner).mint(addr1.address, issueAmt)
      await staticATokenERC20.connect(addr1).approve(one.rToken.address, issueAmt)
      await one.rToken.connect(addr1).issue(issueAmt)
      expect(await one.rToken.balanceOf(addr1.address)).to.equal(issueAmt)

      // Donate the inner RToken to the outer RToken
      await one.rToken.connect(addr1).transfer(two.backingManager.address, issueAmt.div(2))
      expect(await two.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Outer RToken should launch revenue auctions with the donated inner RToken
      const rTokSellAmt = issueAmt.div(2).mul(2).div(5)
      const rsrSellAmt = issueAmt.div(2).mul(3).div(5)

      // Note that here the outer RToken actually mints itself as the first step
      await expectEvents(two.facadeTest.runAuctionsForAllTraders(two.rToken.address), [
        {
          contract: two.rToken,
          name: 'Transfer', // Mint
          args: [ZERO_ADDRESS, two.backingManager.address, issueAmt.div(2)],
          emitted: true,
        },
        {
          contract: two.rToken,
          name: 'Transfer',
          args: [two.backingManager.address, two.rTokenTrader.address, rTokSellAmt],
          emitted: true,
        },
        {
          contract: two.rsrTrader,
          name: 'TradeStarted',
          args: [
            anyValue,
            two.rToken.address,
            two.rsr.address,
            rsrSellAmt,
            rsrSellAmt.mul(99).div(100),
          ],
          emitted: true,
        },
      ])

      // Final checks
      expect(await one.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await two.basketHandler.fullyCollateralized()).to.equal(true)
      expect(await one.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await two.basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await one.rToken.totalSupply()).to.equal(issueAmt.mul(2))
      expect(await two.rToken.totalSupply()).to.equal(issueAmt.mul(3).div(2))
      expect(await one.rTokenAsset.strictPrice()).to.equal(fp('1'))
      expect(await rTokenCollateral.strictPrice()).to.equal(fp('1'))
    })

    it('should propagate appreciation of the inner-most collateral to price', async () => {
      expect(await one.rTokenAsset.strictPrice()).to.equal(fp('1'))
      expect(await rTokenCollateral.strictPrice()).to.equal(fp('1'))

      // Cause appreciation
      await staticATokenERC20.setExchangeRate(fp('1.5'))
      await one.assetRegistry.refresh()
      await two.assetRegistry.refresh()

      const rTokSellAmt = issueAmt.div(2).mul(2).div(5).sub(40)
      const rsrSellAmt = issueAmt.div(2).mul(3).div(5).sub(60)
      expect(await staticATokenERC20.balanceOf(one.backingManager.address)).to.equal(issueAmt)

      // Note the inner RToken mints internally since it has excess backing
      await expectEvents(one.facadeTest.runAuctionsForAllTraders(one.rToken.address), [
        {
          contract: one.rToken,
          name: 'Transfer',
          args: [ZERO_ADDRESS, one.backingManager.address, issueAmt.div(2).sub(75)],
          emitted: true,
        },
        {
          contract: one.rToken,
          name: 'Transfer',
          args: [one.rTokenTrader.address, one.furnace.address, rTokSellAmt],
          emitted: true,
        },
        {
          contract: one.rsrTrader,
          name: 'TradeStarted',
          args: [
            anyValue,
            one.rToken.address,
            one.rsr.address,
            rsrSellAmt,
            rsrSellAmt.mul(99).div(100).add(31),
          ],
          emitted: true,
        },
      ])
      await advanceTime(one.config.rewardPeriod.toString())
      await one.furnace.melt()

      // Furnace - melt almost everything
      expect(await one.rToken.balanceOf(one.furnace.address)).to.equal(rTokSellAmt)
      await advanceTime(bn('2').pow(30).toString())
      await one.furnace.melt()

      // Appreciation should be passed through to both tokens
      await setOraclePrice(aTokenCollateral.address, bn('1e8'))
      const expectedPrice = issueAmt.add(rTokSellAmt).mul(fp('1')).div(issueAmt)
      expect(await one.rTokenAsset.strictPrice()).to.be.closeTo(expectedPrice, fp('0.05'))
      expect(await rTokenCollateral.strictPrice()).to.be.closeTo(expectedPrice, fp('0.05'))
    })
  })
})
