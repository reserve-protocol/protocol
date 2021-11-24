import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { ProtoAdapter } from '../../typechain/ProtoAdapter'
import { ProtosDriver } from '../../typechain/ProtosDriver'
import { IManagerConfig } from '../p0/utils/fixtures'
import { getLatestBlockTimestamp } from '../utils/time'
import { Account, COLLATERAL_TOKEN_LEN, CollateralToken, prepareState } from './common'

/*
 *  Generic Unit Tests
 *
 *  These tests assert that contract invariants are met after each individual tx. The tx will revert if:
 *    (i)  an implementation invariant is violated.
 *    (ii) implementations fall out of sync with each other (requires multiple implementations)
 *
 *
 */
describe('Generic unit tests', () => {
  let Impls: ContractFactory[]
  let driver: ProtosDriver

  beforeEach(async () => {
    // ADD PROTOS (BY CONTRACT NAME) TO THIS ARRAY AS WE FINISH THEM
    Impls = [await ethers.getContractFactory('AdapterP0')]
  })

  describe('Setup', () => {
    let initialState: any

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
      const b1 = { tokens: [CollateralToken.cDAI, CollateralToken.DAI], quantities: [bn('5e7'), bn('5e17')] }
      const b2 = { tokens: [CollateralToken.DAI], quantities: [bn('1e18')] }
      const bu_s = [b1, b2]

      // {Config}   {ETHMicroUSD}   {Balance[]}   {Baskets[]}
      initialState = prepareState(config, bn('4000e6'), [[Account.EVE, bn('1e20')]], [[Account.EVE, bn('1e20')]], bu_s)

      const Driver = await ethers.getContractFactory('ProtosDriver')
      const impls = await Promise.all(Impls.map(async (i) => (<ProtoAdapter>await i.deploy()).address))
      driver = await Driver.deploy(impls)
      await driver.init(initialState)
    })

    it('Should set up correctly', async () => {
      const state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(0)
      expect(state.rToken.balances[Account.EVE]).to.equal(bn('1e20'))
      expect(state.collateral[0].balances[Account.ALICE]).to.equal(bn('1e36'))
      expect(state.collateral[COLLATERAL_TOKEN_LEN - 1].balances[Account.ALICE]).to.equal(bn('1e36'))
      expect(state.rTokenDefinition.tokens.toString()).to.equal(initialState.rTokenDefinition.tokens.toString())
      expect(state.rTokenDefinition.quantities.toString()).to.equal(initialState.rTokenDefinition.quantities.toString())
    })

    it('Should issue, slowly', async () => {
      const amt = bn('1e18')
      await driver.CMD_issue(Account.ALICE, amt)
      let state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(0)

      await driver.CMD_poke() // advance 1 block to cause minting
      state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(amt)
    })

    it('Should redeem', async () => {
      const amt = bn('1e18')
      await driver.CMD_issue(Account.ALICE, amt)
      await driver.CMD_poke() // advance 1 block to cause minting
      let state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(amt)
      await driver.CMD_redeem(Account.ALICE, amt)
      state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(bn(0))
    })

    it('Should stake RSR', async () => {
      let state = await driver.callStatic.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(bn(0))
      const amt = bn('1e18')
      await driver.CMD_stakeRSR(Account.ALICE, amt)
      state = await driver.callStatic.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(amt)
    })

    it('Should unstake RSR', async () => {
      const amt = bn('1e18')
      await driver.CMD_stakeRSR(Account.ALICE, amt)
      let state = await driver.callStatic.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(amt)
      await driver.CMD_unstakeRSR(Account.ALICE, amt)
      state = await driver.callStatic.state()
      expect(state.stRSR.balances[Account.ALICE]).to.equal(bn(0))
    })
  })
})
