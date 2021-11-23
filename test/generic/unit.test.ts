import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { ProtoAdapter } from '../../typechain/ProtoAdapter'
import { ProtosDriver } from '../../typechain/ProtosDriver'
import { IManagerConfig } from '../p0/utils/fixtures'
import { getLatestBlockTimestamp } from '../utils/time'

/*
 * The Generic Unit tests are written against ProtoState and ProtosDriver. The ProtosDriver can be set
 * up with any number of implementations to test in parallel, and will check to ensure that the states
 * match across implementations after each command. It also checks the invariants. This enables
 * the generic test suite to pretend it is interacting with a single system.
 */

// @dev Must match `ProtoState.CollateralToken`
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

// @dev Must match `ProtoState.Account`
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

type Allowance = [Account, Account, BigNumber]
type Balance = [Account, BigNumber]
type Basket = { tokens: CollateralToken[]; quantities: BigNumber[] }

describe('Generic unit tests', () => {
  let owner: SignerWithAddress
  let Impls: ContractFactory[]
  let driver: ProtosDriver

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

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

/// Helper to prepare two-dimensional allowance arrays
const prepareAllowances = (...allowance: Array<Allowance>) => {
  const toReturn: BigNumber[][] = [] // 2d
  for (let i = 0; i < ACCOUNTS_LEN; i++) {
    toReturn.push([])
    for (let j = 0; j < ACCOUNTS_LEN; j++) {
      toReturn[i].push(bn(0))
    }
  }
  for (let i = 0; i < allowance.length; i++) {
    toReturn[allowance[i][0]][allowance[i][1]] = toReturn[allowance[i][0]][allowance[i][1]].add(allowance[i][2])
  }
  return toReturn
}

/// Helper to prepare balance arrays
const prepareBalances = (...balance: Array<Balance>) => {
  const toReturn: BigNumber[] = []
  for (let i = 0; i < ACCOUNTS_LEN; i++) {
    toReturn.push(bn(0))
  }
  for (let i = 0; i < balance.length; i++) {
    toReturn[balance[i][0]] = toReturn[balance[i][0]].add(balance[i][1])
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

// Creates a state where Alice has standing balances of all the "input" tokens (collateral + RSR + COMP + AAVE)
// and the caller provides balances of RToken/stRSR.
const prepareState = (
  config: IManagerConfig,
  ethPriceMicroUSD: BigNumber,
  rTokenBalances: Balance[],
  stRSRBalances: Balance[],
  baskets: Basket[] // 0th basket is taken to be current RToken definition
) => {
  const ethPrice = { inUSD: ethPriceMicroUSD, inETH: bn('1e18') }
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
  const rToken = makeToken('USD+', rTokenBalances, [], bn('1e6'))
  const rsr = makeToken('RSR', [[Account.ALICE, bn('1e36')]], [], bn('1e6'))
  const stRSR = makeToken('stUSD+RSR', stRSRBalances, [], bn('1e6'))
  const comp = makeToken('COMP', [[Account.ALICE, bn('1e36')]], [], bn('1e6'))
  const aave = makeToken('AAVE', [[Account.ALICE, bn('1e36')]], [], bn('1e6'))
  const collateral = []
  for (let i = 0; i < COLLATERAL_TOKEN_LEN; i++) {
    collateral.push(makeToken(CollateralToken[i], [[Account.ALICE, bn('1e36')]], [], bn('1e6')))
  }

  return {
    bu_s: baskets,
    config: config,
    rTokenDefinition: baskets[0],
    rToken: rToken,
    rsr: rsr,
    stRSR: stRSR,
    comp: comp,
    aave: aave,
    collateral: collateral,
    ethPrice: ethPrice,
  }
}
