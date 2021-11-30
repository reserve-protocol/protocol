import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { ProtoAdapter } from '../../typechain/ProtoAdapter'
import { ProtosDriver } from '../../typechain/ProtosDriver'
import { IManagerConfig } from '../p0/utils/fixtures'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import {
  Account,
  Asset,
  ASSET_TOKEN_LEN,
  Balance,
  COLLATERAL_TOKEN_LEN,
  DefiRate,
  Mood,
  prepareState,
  prepareToPrice,
  Price,
} from './common'

/*
 *  Generic Unit Tests
 *
 *  Unit tests leverage a generic testing interface in order to run small sets of transformations
 *  and assert that a subset of the resulting state is correct.
 *
 *  I'm not sure how long we need to keep these around, they are mostly useful for testing the generic testing suite itself.
 *
 *  These tests also implicitly assert that contract invariants are met after each individual tx. The tx will revert if:
 *    (i)  an implementation invariant is violated.
 *    (ii) implementations fall out of sync with each other (requires multiple implementations)
 *
 *
 */
describe('Unit tests (Generic)', () => {
  let Impls: ContractFactory[]
  let driver: ProtosDriver

  beforeEach(async () => {
    // ADD PROTOS (BY CONTRACT NAME) TO THIS ARRAY AS WE FINISH THEM
    Impls = [await ethers.getContractFactory('AdapterP0')]
  })

  describe('Setup', () => {
    let initialState: any
    let toPrice: (microUSD: BigNumber) => Price

    beforeEach(async () => {
      // Config
      const config: IManagerConfig = {
        rewardStart: bn(await getLatestBlockTimestamp()),
        rewardPeriod: bn('604800'), // 1 week
        auctionPeriod: bn('1800'), // 30 minutes
        stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
        defaultDelay: bn('86400'), // 24 hrs
        maxTradeSlippage: fp('0.05'), // 5%
        maxAuctionSize: fp('0.01'), // 1%
        minRecapitalizationAuctionSize: fp('0.001'), // 0.1%
        minRevenueAuctionSize: fp('0.0001'), // 0.01%
        migrationChunk: fp('0.2'), // 20%
        issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
        defaultThreshold: fp('0.05'), // 5% deviation
        f: fp('0.60'), // 60% to stakers
      }
      const b1 = { assets: [Asset.cDAI, Asset.USDC], quantities: [bn('5e7'), bn('5e5')] }
      const b2 = { assets: [Asset.USDC], quantities: [bn('1e6')] }
      const b3 = { assets: [Asset.cDAI], quantities: [bn('1e8')] }
      const baskets = [b1, b2, b3]

      const ethPrice = { inUSD: bn('4000e6'), inETH: bn('1e18') }
      toPrice = prepareToPrice(ethPrice)

      /// Human-usable configuration from common
      const rTokenBal: Balance[] = [[Account.EVE, bn('1e20')]]
      const stRSRBal: Balance[] = [[Account.EVE, bn('1e20')]]
      const defiRates: DefiRate[] = []

      initialState = prepareState(config, ethPrice, rTokenBal, stRSRBal, defiRates, baskets)
      // console.log(initialState)

      const Driver = await ethers.getContractFactory('ProtosDriver')
      const impls = await Promise.all(Impls.map(async (i) => (<ProtoAdapter>await i.deploy()).address))
      driver = <ProtosDriver>await Driver.deploy(impls)
      await driver.init(initialState)
    })

    it('Should set up correctly', async () => {
      const state = await driver.state()
      const lastCollateral = COLLATERAL_TOKEN_LEN - 1
      expect(state.state).to.equal(Mood.CALM)
      expect(state.rToken.balances[Account.ALICE]).to.equal(0)
      expect(state.rToken.balances[Account.EVE]).to.equal(bn('1e20'))
      expect(state.collateral[0].balances[Account.ALICE]).to.equal(bn('1e36'))
      expect(state.collateral[lastCollateral].balances[Account.ALICE]).to.equal(bn('1e36'))
      expect(state.comp.balances[Account.ALICE]).to.equal(bn('1e36'))
      expect(state.rTokenDefinition.assets.toString()).to.equal(initialState.rTokenDefinition.assets.toString())
      expect(state.rTokenDefinition.quantities.toString()).to.equal(initialState.rTokenDefinition.quantities.toString())
      expect(state.defiCollateralRates[0]).to.equal(initialState.defiCollateralRates[0])
      expect(state.defiCollateralRates[lastCollateral]).to.equal(initialState.defiCollateralRates[lastCollateral])
      expect(state.defiCollateralRates.length).to.equal(state.collateral.length)
    })

    it('Prices can be set', async () => {
      let state = await driver.state()
      expectPricesEqual(state.comp.price, toPrice(bn('1e6')))
      expectPricesEqual(state.collateral[Asset.USDC].price, toPrice(bn('1e6')))
      const compPrice = toPrice(bn('2e6'))
      const collatPrice = toPrice(bn('0.5e6'))
      await driver.setBaseAssetPrices([Asset.COMP, Asset.USDC], [compPrice, collatPrice])
      state = await driver.state()
      expectPricesEqual(state.comp.price, compPrice)
      expectPricesEqual(state.collateral[Asset.USDC].price, collatPrice)
      expectPricesEqual(state.collateral[Asset.cUSDC].price, toPrice(bn(0)))
      expectPricesEqual(state.collateral[Asset.aUSDC].price, toPrice(bn(0)))
    })

    it('Defi rates can be set', async () => {
      let state = await driver.state()
      const lastCollateral = COLLATERAL_TOKEN_LEN - 1
      expect(state.defiCollateralRates[0]).to.equal(fp('0'))
      expect(state.defiCollateralRates[lastCollateral]).to.equal(fp('1'))
      const cDaiRate = fp('0.9')
      const aBUSDRate = fp('1.1')
      await driver.setDefiCollateralRates([Asset.cDAI, Asset.aBUSD], [cDaiRate, aBUSDRate])
      state = await driver.state()
      expect(state.defiCollateralRates[Asset.cDAI]).to.equal(cDaiRate)
      expect(state.defiCollateralRates[Asset.aBUSD]).to.equal(aBUSDRate)
    })

    it('Should issue, slowly', async () => {
      const amt = bn('1e18')
      await driver.CMD_issue(Account.ALICE, amt)
      let state = await driver.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(0)

      await driver.CMD_poke() // advance 1 block to cause minting
      state = await driver.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(amt)
    })

    it('Should redeem', async () => {
      const amt = bn('1e20')
      let state = await driver.state()
      expect(state.rToken.balances[Account.EVE]).to.equal(amt)
      await driver.CMD_redeem(Account.EVE, amt)
      state = await driver.state()
      expect(state.rToken.balances[Account.EVE]).to.equal(bn(0))
    })

    it('Should stake RSR', async () => {
      let state = await driver.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(bn(0))
      const amt = bn('1e18')
      await driver.CMD_stakeRSR(Account.ALICE, amt)
      state = await driver.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(amt)
    })

    it('Should unstake RSR', async () => {
      const amt = bn('1e18')
      await driver.CMD_stakeRSR(Account.ALICE, amt)
      let state = await driver.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(amt)
      await driver.CMD_unstakeRSR(Account.ALICE, amt)
      state = await driver.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(bn(0))
    })

    it('Should detect hard default + immediately migrate to backup vault', async () => {
      await driver.setDefiCollateralRates([Asset.cDAI], [initialState.defiCollateralRates[Asset.cDAI].sub(bn(1))])
      await driver.CMD_poke()
      let state = await driver.state()
      expect(state.state).to.equal(Mood.TRADING)
      expect(state.bu_s.length).to.equal(2)
      expect(state.rTokenDefinition.assets.toString()).to.equal([Asset.USDC].toString())
      expect(state.rTokenDefinition.quantities.toString()).to.equal([bn('1e6')].toString())
    })

    it('Should detect soft default + migrate to backup vault after 24h', async () => {
      await driver.setBaseAssetPrices([Asset.USDC], [toPrice(bn('0.9e6'))])
      await driver.CMD_checkForDefault()
      advanceTime(initialState.config.defaultDelay)
      await driver.CMD_checkForDefault()
      await driver.CMD_poke()
      let state = await driver.state()
      expect(state.state).to.equal(Mood.TRADING)
      expect(state.bu_s.length).to.equal(1)
      expect(state.rTokenDefinition.assets.toString()).to.equal([Asset.cDAI].toString())
      expect(state.rTokenDefinition.quantities.toString()).to.equal([bn('1e8')].toString())
    })
  })
})

const expectPricesEqual = (p1: Price | BigNumber[], p2: Price): void => {
  if (Object.prototype.toString.call(p1) === '[object Array]') {
    p1 = p1 as BigNumber[]
    p1 = { inETH: p1[0], inUSD: p1[1] }
  }
  p1 = p1 as Price
  expect(p1.inETH).to.equal(p2.inETH)
  expect(p1.inUSD).to.equal(p2.inUSD)
}
