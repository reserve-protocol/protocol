import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { BN_SCALE_FACTOR, CollateralStatus } from '../common/constants'
import { bn, fp, shortString, toBNDecimals } from '../common/numbers'
import {
  ERC20MockDecimals,
  FiatCollateral,
  IAssetRegistry,
  MockV3Aggregator,
  TestIBackingManager,
  TestIBasketHandler,
  TestIRToken,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import { advanceTime } from './utils/time'
import {
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  SLOW,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  defaultFixtureNoBasket,
} from './fixtures'
import { cartesianProduct } from './utils/cases'
import { useEnv } from '#/utils/env'

const describeExtreme =
  IMPLEMENTATION == Implementation.P1 && useEnv('EXTREME') ? describe.only : describe.skip

describe(`RTokenP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Main
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({ assetRegistry, backingManager, basketHandler, rToken } = await loadFixture(
      defaultFixtureNoBasket
    ))
  })

  describeExtreme(`Extreme Values ${SLOW ? 'slow mode' : 'fast mode'}`, () => {
    // makeColl: Deploy and register a new constant-price collateral
    async function makeColl(index: number | string, decimals: number): Promise<ERC20MockDecimals> {
      const ERC20: ContractFactory = await ethers.getContractFactory('ERC20MockDecimals')
      const erc20: ERC20MockDecimals = <ERC20MockDecimals>(
        await ERC20.deploy('Token ' + index, 'T' + index, decimals)
      )
      const OracleFactory: ContractFactory = await ethers.getContractFactory('MockV3Aggregator')
      const oracle: MockV3Aggregator = <MockV3Aggregator>await OracleFactory.deploy(8, bn('1e8'))
      await oracle.deployed() // fix extreme value tests failing
      const CollateralFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral')
      const coll: FiatCollateral = <FiatCollateral>await CollateralFactory.deploy({
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: oracle.address,
        oracleError: ORACLE_ERROR,
        erc20: erc20.address,
        maxTradeVolume: fp('1e36'),
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01'),
        delayUntilDefault: bn(86400),
      })
      await assetRegistry.register(coll.address)
      expect(await assetRegistry.isRegistered(erc20.address)).to.be.true
      await backingManager.grantRTokenAllowance(erc20.address)
      return erc20
    }

    async function forceUpdateGetStatus(): Promise<CollateralStatus> {
      await whileImpersonating(basketHandler.address, async (bhSigner) => {
        await assetRegistry.connect(bhSigner).refresh()
      })
      return basketHandler.status()
    }

    async function runScenario([
      toIssue,
      toRedeem,
      totalSupply, // in this scenario, rtoken supply _after_ issuance.
      numBasketAssets,
      weightFirst, // target amount per asset (weight of first asset)
      weightRest, // another target amount per asset (weight of second+ assets)
      issuancePctAmt, // range under test: [.000_001 to 1.0]
      redemptionPctAmt, // range under test: [.000_001 to 1.0]
      collateralDecimals,
    ]: BigNumber[]) {
      // skip nonsense cases
      if (
        (numBasketAssets.eq(1) && !weightRest.eq(1)) ||
        toRedeem.gt(totalSupply) ||
        toIssue.gt(totalSupply)
      ) {
        return
      }

      // ==== Deploy and register basket collateral

      const N = numBasketAssets.toNumber()
      const erc20s: ERC20MockDecimals[] = []
      const weights: BigNumber[] = []
      let totalWeight: BigNumber = fp(0)
      for (let i = 0; i < N; i++) {
        const erc20 = await makeColl(i, Number(collateralDecimals))
        erc20s.push(erc20)
        const currWeight = i == 0 ? weightFirst : weightRest
        weights.push(currWeight)
        totalWeight = totalWeight.add(currWeight)
      }
      expect(await forceUpdateGetStatus()).to.equal(CollateralStatus.DISABLED)

      // ==== Switch Basket

      const basketAddresses: string[] = erc20s.map((erc20) => erc20.address)
      await basketHandler.connect(owner).setPrimeBasket(basketAddresses, weights)
      await basketHandler.connect(owner).refreshBasket()
      expect(await forceUpdateGetStatus()).to.equal(CollateralStatus.SOUND)

      for (let i = 0; i < basketAddresses.length; i++) {
        expect(await basketHandler.quantity(basketAddresses[i])).to.equal(weights[i])
      }

      // ==== Mint basket tokens to owner and addr1

      const toIssue0 = totalSupply.sub(toIssue)
      const e18 = BN_SCALE_FACTOR
      for (let i = 0; i < N; i++) {
        const erc20: ERC20MockDecimals = erc20s[i]
        // user owner starts with enough basket assets to issue (totalSupply - toIssue)
        const toIssue0Scaled: BigNumber = toBNDecimals(toIssue0, Number(collateralDecimals))
        const toMint0: BigNumber = toIssue0Scaled.mul(weights[i]).add(e18.sub(1)).div(e18)
        await erc20.mint(owner.address, toMint0)
        await erc20.connect(owner).increaseAllowance(rToken.address, toMint0)

        // user addr1 starts with enough basket assets to issue (toIssue)
        const toIssueScaled: BigNumber = toBNDecimals(toIssue, Number(collateralDecimals))
        const toMint: BigNumber = toIssueScaled.mul(weights[i]).add(e18.sub(1)).div(e18)
        await erc20.mint(addr1.address, toMint)
        await erc20.connect(addr1).increaseAllowance(rToken.address, toMint)
      }

      // Set up throttles
      const issuanceThrottleParams = { amtRate: bn('1e48'), pctRate: issuancePctAmt }
      const redemptionThrottleParams = { amtRate: bn('1e48'), pctRate: redemptionPctAmt }

      await rToken.connect(owner).setIssuanceThrottleParams(issuanceThrottleParams)
      await rToken.connect(owner).setRedemptionThrottleParams(redemptionThrottleParams)

      // Recharge throttle
      await advanceTime(3600)
      await advanceTime(await basketHandler.warmupPeriod())

      // ==== Issue the "initial" rtoken supply to owner
      expect(await rToken.balanceOf(owner.address)).to.equal(bn(0))
      if (toIssue0.gt(0)) {
        await rToken.connect(owner).issue(toIssue0)
        expect(await rToken.balanceOf(owner.address)).to.equal(toIssue0)
      }

      // ==== Issue the toIssue supply to addr1

      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      await rToken.connect(addr1).issue(toIssue)
      expect(await rToken.balanceOf(addr1.address)).to.equal(toIssue)

      // ==== Send enough rTokens to addr2 that it can redeem the amount `toRedeem`

      // owner has toIssue0 rToken, addr1 has toIssue rToken.
      if (toRedeem.lte(toIssue0)) {
        await rToken.connect(owner).transfer(addr2.address, toRedeem)
      } else {
        await rToken.connect(owner).transfer(addr2.address, toIssue0)
        await rToken.connect(addr1).transfer(addr2.address, toRedeem.sub(toIssue0))
      }
      expect(await rToken.balanceOf(addr2.address)).to.equal(toRedeem)

      // ==== Redeem tokens

      await rToken.connect(addr2).redeem(toRedeem)
      expect(await rToken.balanceOf(addr2.address)).to.equal(0)
    }

    // ==== Generate the tests
    const MAX_RTOKENS = bn('1e48')
    const MAX_WEIGHT = fp(1000)
    const MIN_WEIGHT = fp('1e-6')
    const MIN_ISSUANCE_PCT = fp('1e-6')
    const MIN_REDEMPTION_PCT = fp('1e-6')
    const MIN_RTOKENS = fp('1e-6')

    let paramList

    if (SLOW) {
      const bounds: BigNumber[][] = [
        [MIN_RTOKENS, MAX_RTOKENS, bn('1.205e24')], // toIssue
        [MIN_RTOKENS, MAX_RTOKENS, bn('4.4231e24')], // toRedeem
        [MAX_RTOKENS, bn('7.907e24')], // totalSupply
        [bn(1), bn(3), bn(100)], // numAssets
        [MIN_WEIGHT, MAX_WEIGHT, fp('0.1')], // weightFirst
        [MIN_WEIGHT, MAX_WEIGHT, fp('0.2')], // weightRest
        [MIN_ISSUANCE_PCT, fp('1e-2'), fp(1)], // issuanceThrottle.pctRate
        [MIN_REDEMPTION_PCT, fp('1e-2'), fp(1)], // redemptionThrottle.pctRate
        [bn(6), bn(18), bn(21), bn(27)], // collateralDecimals
      ]

      paramList = cartesianProduct(...bounds)
    } else {
      const bounds: BigNumber[][] = [
        [MIN_RTOKENS, MAX_RTOKENS], // toIssue
        [MIN_RTOKENS, MAX_RTOKENS], // toRedeem
        [MAX_RTOKENS], // totalSupply
        [bn(1), bn(3)], // numAssets
        [MIN_WEIGHT, MAX_WEIGHT], // weightFirst
        [MIN_WEIGHT], // weightRest
        [MIN_ISSUANCE_PCT, fp(1)], // issuanceThrottle.pctRate
        [MIN_REDEMPTION_PCT, fp(1)], // redemptionThrottle.pctRate
        [bn(6), bn(18), bn(27)], // collateralDecimals
      ]
      paramList = cartesianProduct(...bounds)
    }
    const numCases = paramList.length.toString()

    paramList.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(params)
      })
    })
  })
})
