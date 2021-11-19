import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber } from 'ethers'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'
import { bn, fp } from '../../common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0'
import { ProtoAdapter } from '../../typechain/ProtoAdapter'
import { ProtosDriver } from '../../typechain/ProtosDriver'
import { AdapterP0 } from '../../typechain/AdapterP0'
import { IManagerConfig } from '../p0/utils/fixtures'

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

// Inserts all allowance triples into a 2d array mapping the Account enum to indices
const allowance2D = (...allowance: Array<[Account, Account, BigNumber]>) => {
  const toReturn: BigNumber[][] = [] // 2d
  for (let i = 0; i < Account.MAIN + 1; i++) {
    toReturn[i] = []
    for (let j = 0; j < Account.MAIN + 1; j++) {
      toReturn[i][j] = bn(0)
    }
  }
  for (let i = 0; i < allowance.length; i++) {
    toReturn[allowance[i][0]][allowance[i][1]] = allowance[i][2]
  }
  return toReturn
}

describe('Generic unit tests', () => {
  let owner: SignerWithAddress
  let Impls: ContractFactory[]
  let driver: ProtosDriver

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()
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

      const ethPrice = { inUSD: bn('4000e6'), inETH: bn('1e18') } // $4k ETH
      const makePrice = (microUSD: BigNumber) => {
        return { inUSD: microUSD, inETH: microUSD.mul(bn('1e12')).div(ethPrice.inUSD) }
      }

      const emptyBalances = [0, 0, 0, 0, 0, 0, 0, 0] // 8 accounts
      const rToken = {
        name: 'USD+ RToken',
        symbol: 'USD+',
        balances: emptyBalances,
        allowances: allowance2D(),
        totalSupply: 0,
        price: makePrice(bn('1e6')),
      }
      const rsr = {
        name: 'Reserve Rights Token',
        symbol: 'RSR',
        balances: emptyBalances,
        allowances: allowance2D(),
        totalSupply: 0,
        price: makePrice(bn('1e6')),
      }
      const stRSR = {
        name: 'Staked USD+ RSR Token',
        symbol: 'stUSD+RSR',
        balances: emptyBalances,
        allowances: allowance2D(),
        totalSupply: 0,
        price: makePrice(bn('1e6')),
      }
      const comp = {
        name: 'Compound Token',
        symbol: 'COMP',
        balances: emptyBalances,
        allowances: allowance2D(),
        totalSupply: 0,
        price: makePrice(bn('1e6')),
      }
      const aave = {
        name: 'Aave Token',
        symbol: 'AAVE',
        balances: emptyBalances,
        allowances: allowance2D(),
        totalSupply: 0,
        price: makePrice(bn('1e6')),
      }
      const collateral = [
        {
          name: 'DAI Token',
          symbol: CollateralToken[CollateralToken.DAI],
          balances: [bn('1e36'), 0, 0, 0, 0, 0, 0, 0],
          allowances: allowance2D([Account.ALICE, Account.MAIN, bn('1e36')], [Account.ALICE, Account.BOB, bn('1e36')]),
          totalSupply: bn('1e36'),
          price: makePrice(bn('1e6')),
        },
        {
          name: 'USDC Token',
          symbol: CollateralToken[CollateralToken.USDC],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'USDT Token',
          symbol: CollateralToken[CollateralToken.USDT],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'BUSD Token',
          symbol: CollateralToken[CollateralToken.BUSD],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'cDAI Token',
          symbol: CollateralToken[CollateralToken.cDAI],
          balances: [bn('1e36'), 0, 0, 0, 0, 0, 0, 0],
          allowances: allowance2D([Account.ALICE, Account.MAIN, bn('1e36')]),
          totalSupply: bn('1e36'),
          price: makePrice(bn('1e6')),
        },
        {
          name: 'cUSDC Token',
          symbol: CollateralToken[CollateralToken.cUSDC],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'cUSDT Token',
          symbol: CollateralToken[CollateralToken.cUSDT],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'aDAI Token',
          symbol: CollateralToken[CollateralToken.aDAI],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'aUSDC Token',
          symbol: CollateralToken[CollateralToken.aUSDC],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'aUSDT Token',
          symbol: CollateralToken[CollateralToken.aUSDT],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
        {
          name: 'aBUSD Token',
          symbol: CollateralToken[CollateralToken.aBUSD],
          balances: emptyBalances,
          allowances: allowance2D(),
          totalSupply: 0,
          price: makePrice(bn('1e6')),
        },
      ]

      const b1 = { tokens: [CollateralToken.cDAI, CollateralToken.DAI], quantities: [bn('5e7'), bn('5e17')] }
      const b2 = { tokens: [CollateralToken.DAI], quantities: [bn('1e18')] }
      const baskets = [b1, b2]
      initialState = {
        baskets: baskets,
        config: config,
        rTokenRedemption: b1,
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
  })
})
