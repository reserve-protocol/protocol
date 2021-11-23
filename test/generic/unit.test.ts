import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AdapterP0 } from '../../typechain/AdapterP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { ProtoAdapter } from '../../typechain/ProtoAdapter'
import { ProtosDriver } from '../../typechain/ProtosDriver'
import { IManagerConfig } from '../p0/utils/fixtures'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'

/*
 * The Generic Unit tests are written against ProtoState and ProtosDriver. The ProtosDriver can be set
 * up with any number of implementations to test in parallel, and will check to ensure that the states
 * match across implementations after each command. It also checks the invariants. This enables
 * the generic test suite to pretend it is interacting with a single system.
 */

// Must match `ProtoState.CollateralToken`
enum CollateralToken {
  DAI,
  USDC,
  USDT,
  BUSD,
  cDAI,
  cUSDC,
  cUSDT,
  aDAI,
  aUSDC,
  aUSDT,
  aBUSD,
}
const COLLATERAL_TOKEN_LEN = 11

// Must match `ProtoState.Account`
enum Account {
  ALICE,
  BOB,
  CHARLIE,
  DAVE,
  EVE,
  //
  RTOKEN,
  STRSR,
  MAIN,
}
const ACCOUNTS_LEN = 8

/// Helper to prepare two-dimensional allowance arrays
const prepareAllowances = (...allowance: Array<[Account, Account, BigNumber]>) => {
  const toReturn: BigNumber[][] = [] // 2d
  for (let i = 0; i < ACCOUNTS_LEN; i++) {
    toReturn.push([])
    for (let j = 0; j < ACCOUNTS_LEN; j++) {
      toReturn[i].push(bn(0))
    }
  }
  for (let i = 0; i < allowance.length; i++) {
    toReturn[allowance[i][0]][allowance[i][1]] = allowance[i][2]
  }
  return toReturn
}

/// Helper to prepare balance arrays
const prepareBalances = (...balance: Array<[Account, BigNumber]>) => {
  const toReturn: BigNumber[] = []
  for (let i = 0; i < ACCOUNTS_LEN; i++) {
    toReturn.push(bn(0))
  }
  for (let i = 0; i < balance.length; i++) {
    toReturn[balance[i][0]] = balance[i][1]
  }
  return toReturn
}

const sum = (arr: Array<BigNumber>) => {
  let total = bn(0)
  for (let i = 0; i < arr.length; i++) {
    total = total.add(arr[i])
  }
  return total
}

describe('Generic unit tests', () => {
  let owner: SignerWithAddress
  let Impls: ContractFactory[]
  let driver: ProtosDriver

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // ADD PROTOS TO THIS ARRAY AS WE FINISH THEM
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

      // $4k ETH
      const ethPrice = { inUSD: bn('4000e6'), inETH: bn('1e18') }
      const makeToken = (
        symbol: string,
        balances: Array<[Account, BigNumber]>,
        allowances: Array<[Account, Account, BigNumber]>,
        microUSDPrice: BigNumber
      ) => {
        const bals = prepareBalances(...balances)
        return {
          name: symbol + ' Token',
          symbol: symbol,
          balances: bals,
          allowances: prepareAllowances(...allowances),
          totalSupply: sum(bals),
          price: { inUSD: microUSDPrice, inETH: microUSDPrice.mul(bn('1e12')).div(ethPrice.inUSD) },
        }
      }

      // {symbol}, {balances}, {allowances}, {microUSD price}
      const rToken = makeToken('RTKN', [], [], bn('1e6'))
      const rsr = makeToken('RSR', [], [], bn('1e6'))
      const stRSR = makeToken('stRTKNRSR', [], [], bn('1e6'))
      const comp = makeToken('COMP', [], [], bn('1e6'))
      const aave = makeToken('AAVE', [], [], bn('1e6'))
      const collateral = [
        makeToken('DAI', [[Account.ALICE, bn('1e36')]], [[Account.ALICE, Account.MAIN, bn('1e36')]], bn('1e6')),
        makeToken('USDC', [], [], bn('1e6')),
        makeToken('USDT', [], [], bn('1e6')),
        makeToken('BUSD', [], [], bn('1e6')),
        makeToken('cDAI', [[Account.ALICE, bn('1e36')]], [[Account.ALICE, Account.MAIN, bn('1e36')]], bn('1e6')),
        makeToken('cUSDC', [], [], bn('1e6')),
        makeToken('cUSDT', [], [], bn('1e6')),
        makeToken('aDAI', [], [], bn('1e6')),
        makeToken('aUSDC', [], [], bn('1e6')),
        makeToken('aUSDT', [], [], bn('1e6')),
        makeToken('aBUSD', [], [], bn('1e6')),
      ]

      const b1 = { tokens: [CollateralToken.cDAI, CollateralToken.DAI], quantities: [bn('5e7'), bn('5e17')] }
      const b2 = { tokens: [CollateralToken.DAI], quantities: [bn('1e18')] }
      const bu_s = [b1, b2]

      initialState = {
        bu_s: bu_s,
        config: config,
        rTokenDefinition: b1,
        rToken: rToken,
        rsr: rsr,
        stRSR: stRSR,
        comp: comp,
        aave: aave,
        collateral: collateral,
        ethPrice: ethPrice,
      }

      const impls = []
      for (let i = 0; i < Impls.length; i++) {
        impls.push((<ProtoAdapter>await Impls[i].deploy()).address)
      }

      const Driver = await ethers.getContractFactory('ProtosDriver')
      driver = await Driver.deploy(impls)
      await driver.init(initialState)
    })

    it('Should exactly match initialState', async () => {
      expect(await driver.callStatic.matches(initialState)).to.equal(true)
    })

    it('Should issue, slowly', async () => {
      const amt = bn('1e18')
      await driver.CMD_issue(Account.ALICE, amt)
      let state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(0)

      await driver.CMD_poke() // advance 1 block to cause minting
      state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(bn('1e18'))
    })

    it('Should redeem', async () => {
      const amt = bn('1e18')
      await driver.CMD_issue(Account.ALICE, amt)
      await driver.CMD_poke() // advance 1 block to cause minting
      let state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(bn('1e18'))
      await driver.CMD_redeem(Account.ALICE, amt)
      state = await driver.callStatic.state()
      expect(state.rToken.balances[Account.ALICE]).to.equal(bn('0'))
    })
  })
})
