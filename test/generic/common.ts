import { BigNumber } from 'ethers'

import { bn, fp } from '../../common/numbers'
import { IManagerConfig } from '../p0/utils/fixtures'

// @dev Must match `ProtoState.CollateralToken`
export enum CollateralToken {
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
export const COLLATERAL_TOKEN_LEN = 11

// @dev Must match `ProtoState.Account`
export enum Account {
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
export const ACCOUNTS_LEN = 8

export type Balance = [Account, BigNumber]
export type Basket = { tokens: CollateralToken[]; quantities: BigNumber[] }

export type Allowance = [Account, Account, BigNumber]

/// Helper to prepare two-dimensional allowance arrays
export const prepareAllowances = (...allowance: Array<Allowance>) => {
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
export const prepareBalances = (...balance: Array<Balance>) => {
  const toReturn: BigNumber[] = []
  for (let i = 0; i < ACCOUNTS_LEN; i++) {
    toReturn.push(bn(0))
  }
  for (let i = 0; i < balance.length; i++) {
    toReturn[balance[i][0]] = toReturn[balance[i][0]].add(balance[i][1])
  }
  return toReturn
}

export const sum = (arr: Array<BigNumber>) => {
  let total = bn(0)
  for (let i = 0; i < arr.length; i++) {
    total = total.add(arr[i])
  }
  return total
}

// Creates a state where Alice has standing balances of all the "input" tokens (collateral + RSR + COMP + AAVE)
// and the caller provides balances of RToken/stRSR.
export const prepareState = (
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
  const collateral = []
  for (let i = 0; i < COLLATERAL_TOKEN_LEN; i++) {
    collateral.push(makeToken(CollateralToken[i], [[Account.ALICE, bn('1e36')]], [], bn('1e6')))
  }

  return {
    bu_s: baskets,
    config: config,
    rTokenDefinition: baskets[0],
    rToken: makeToken('RTKN', rTokenBalances, [], bn('1e6')),
    rsr: makeToken('RSR', [[Account.ALICE, bn('1e36')]], [], bn('1e6')),
    stRSR: makeToken('stRTKNRSR', stRSRBalances, [], bn('1e6')),
    comp: makeToken('COMP', [[Account.ALICE, bn('1e36')]], [], bn('1e6')),
    aave: makeToken('AAVE', [[Account.ALICE, bn('1e36')]], [], bn('1e6')),
    collateral: collateral,
    ethPrice: ethPrice,
  }
}
