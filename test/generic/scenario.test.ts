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
  prepareState,
  prepareToPrice,
  Price,
  SystemState,
} from './common'

/*
 *  Generic Scenario Tests
 *
 *  Scenario tests leverage a generic testing interface in order to run small sets of transformations
 *  and assert that a subset of the resulting state is correct.
 *
 *  These tests also implicitly assert that contract invariants are met after each individual tx. The tx will revert if:
 *    (i)  an implementation invariant is violated.
 *    (ii) implementations fall out of sync with each other (requires multiple implementations)
 *
 *
 */
describe('Scenario tests (Generic)', () => {
  let Impls: ContractFactory[]
  let driver: ProtosDriver

  beforeEach(async () => {
    // ADD PROTOS (BY CONTRACT NAME) TO THIS ARRAY AS WE FINISH THEM
    Impls = [await ethers.getContractFactory('AdapterP0')]
  })

  describe('Setup', () => {
    let initialState: any
    let toPrice: (microUSD: BigNumber, multiplier?: BigNumber) => Price

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
      const bu_s = [b1, b2]

      const ethPrice = { inUSD: bn('4000e6'), inETH: bn('1e18') }
      toPrice = prepareToPrice(ethPrice)

      /// Human-usable configuration
      const rTokenBal: Balance[] = [[Account.EVE, bn('1e20')]]
      const stRSRBal: Balance[] = [[Account.EVE, bn('1e20')]]
      const defiRates: DefiRate[] = []

      initialState = prepareState(config, ethPrice, rTokenBal, stRSRBal, defiRates, bu_s)

      const Driver = await ethers.getContractFactory('ProtosDriver')
      const impls = await Promise.all(Impls.map(async (i) => (<ProtoAdapter>await i.deploy()).address))
      driver = <ProtosDriver>await Driver.deploy(impls)
      await driver.init(initialState)
    })

    it('Should set up correctly', async () => {})

    it('Scenario 1: Issue + Redeem', async () => {
      const amt = bn('1e20')
      await driver.CMD_issue(Account.ALICE, amt)
      await driver.CMD_poke() // advance 1 block to cause minting
      await driver.CMD_redeem(Account.ALICE, amt)
    })

    it('Scenario 2: Config change', async () => {
      const newConfig = initialState.config
      newConfig.f = fp('0.8')
      await driver.setConfig(newConfig)
    })

    it('Scenario 3: Trade', async () => {
      const newConfig = initialState.config
      newConfig.f = fp('0.8')
      await driver.setConfig(newConfig)
    })
  })
})
