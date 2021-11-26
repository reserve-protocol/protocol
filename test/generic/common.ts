import { BigNumber } from 'ethers'

import { bn, fp } from '../../common/numbers'
import { IManagerConfig } from '../p0/utils/fixtures'

// @dev Must match `IMain.SystemState`
export enum SystemState {
  CALM,
  DOUBT,
  TRADING,
}

// @dev Must match `ProtoState.Asset`
export enum Asset {
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
  //
  RSR,
  COMP,
  AAVE,
}
export const FIATCOIN_TOKEN_LEN = 4
export const COLLATERAL_TOKEN_LEN = 11
export const ASSET_TOKEN_LEN = 14

// @dev Must match `ProtoState.Account`
export enum Account {
  ALICE,
  BOB,
  CHARLIE,
  DAVE,
  EVE,
  TRADER,
  //
  RTOKEN,
  STRSR,
  MAIN,
}
export const ACCOUNTS_LEN = 9

export type Balance = [Account, BigNumber]
export type Allowance = [Account, Account, BigNumber]
export type DefiRate = [Asset, BigNumber]
//
export type Basket = { assets: Asset[]; quantities: BigNumber[] }

// inETH: {qETH/tok}, inUSD: {microUSD/tok}
export type Price = { inETH: BigNumber; inUSD: BigNumber }

const check = (b: boolean, s: string) => {
  if (!b) {
    throw new Error(s)
  }
}

// Helper to prepare two-dimensional allowance arrays
export const prepareAllowances = (...allowance: Allowance[]): BigNumber[][] => {
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

// Helper to prepare balance arrays
export const prepareBalances = (...balance: Array<Balance>): BigNumber[] => {
  const toReturn: BigNumber[] = []
  for (let i = 0; i < ACCOUNTS_LEN; i++) {
    toReturn.push(bn(0))
  }
  for (let i = 0; i < balance.length; i++) {
    toReturn[balance[i][0]] = toReturn[balance[i][0]].add(balance[i][1])
  }
  return toReturn
}

// Helper to prepare defi rates
// @return Fixes
export const prepareDefiRates = (...rates: DefiRate[]): BigNumber[] => {
  const toReturn: BigNumber[] = []
  for (let i = 0; i < COLLATERAL_TOKEN_LEN; i++) {
    if (i < FIATCOIN_TOKEN_LEN) {
      toReturn.push(bn(0))
    } else {
      toReturn.push(fp(1))
    }
  }
  for (let i = 0; i < rates.length; i++) {
    check(
      rates[i][0] >= FIATCOIN_TOKEN_LEN && rates[i][0] < COLLATERAL_TOKEN_LEN,
      'defi rates only for ctokens and atokens'
    )
    toReturn[rates[i][0]] = rates[i][1]
  }
  return toReturn
}

// @param microUSD {microUSD/tok}
export const prepareToPrice = (ethPrice: Price): ((microUSD: BigNumber) => Price) => {
  const toPrice = (microUSD: BigNumber): Price => {
    return {
      inUSD: microUSD,
      inETH: microUSD.mul(bn('1e18')).div(ethPrice.inUSD),
    }
  }
  return toPrice
}

export const sum = (arr: Array<BigNumber>) => {
  let total = bn(0)
  for (let i = 0; i < arr.length; i++) {
    total = total.add(arr[i])
  }
  return total
}

// Creates a state where Alice has standing balances of all the "input" tokens (collateral + RSR + COMP + AAVE)
// and the caller provides the target balances for RToken/stRSR.
export const prepareState = (
  config: IManagerConfig,
  ethPrice: Price,
  rTokenBalances: Balance[],
  stRSRBalances: Balance[],
  defiRates: DefiRate[], // only for the cTokens and aTokens (Asset.cDAI-Asset.aBUSD)
  baskets: Basket[] // 0th basket is taken to be current RToken definition
) => {
  const toPrice = prepareToPrice(ethPrice)
  const defiCollateralRates = prepareDefiRates(...defiRates)
  const prepareToken = (
    symbol: string,
    balances: Array<[Account, BigNumber]>,
    allowances: Array<[Account, Account, BigNumber]>,
    microUSD: BigNumber, // ie bn('1e6')
    defiRedemptionRate?: BigNumber // ie fp(1) or bn('1e18'), but only for cToken/aToken
  ) => {
    const bals = prepareBalances(...balances)
    return {
      name: symbol + ' Token',
      symbol: symbol,
      balances: bals,
      allowances: prepareAllowances(...allowances),
      totalSupply: sum(bals),
      price: defiRedemptionRate ? toPrice(bn(0)) : toPrice(microUSD), // cTokens/aTokens should have zero price
    }
  }
  const collateral = []
  for (let i = 0; i < COLLATERAL_TOKEN_LEN; i++) {
    if (i >= FIATCOIN_TOKEN_LEN && i < COLLATERAL_TOKEN_LEN) {
      collateral.push(prepareToken(Asset[i], [[Account.ALICE, bn('1e36')]], [], bn('1e6'), defiCollateralRates[i]))
    } else {
      collateral.push(prepareToken(Asset[i], [[Account.ALICE, bn('1e36')]], [], bn('1e6')))
    }
  }

  return {
    state: SystemState.CALM,
    bu_s: baskets,
    config: config,
    rTokenDefinition: baskets[0],
    rToken: prepareToken('RTKN', rTokenBalances, [], bn('1e6')),
    rsr: prepareToken('RSR', [[Account.ALICE, bn('1e36')]], [], bn('1e6')),
    stRSR: prepareToken('stRTKNRSR', stRSRBalances, [], bn('1e6')),
    comp: prepareToken('COMP', [[Account.ALICE, bn('1e36')]], [], bn('1e6')),
    aave: prepareToken('AAVE', [[Account.ALICE, bn('1e36')]], [], bn('1e6')),
    collateral: collateral,
    defiCollateralRates: defiCollateralRates,
    ethPrice: ethPrice,
  }
}
