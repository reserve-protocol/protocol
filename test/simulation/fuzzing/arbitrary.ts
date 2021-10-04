import { ethers } from 'hardhat'
import { MAX_UINT256 } from '../../../common/constants'
import { bn, pow10 } from '../../../common/numbers'
import { BasketTokenEntry } from './types'
import { BigNumber } from 'ethers'
import { Users, Account } from '../interface'
import * as fc from 'fast-check'

export const bnUint256 = () =>
  fc
    .bigUintN(256)
    .map((amt) => BigNumber.from(amt))
    .filter((bn) => bn.lte(MAX_UINT256))

export const exceptZero = bnUint256().filter((x) => x.toString() !== '0')

export const simpleAmount = fc.integer({min: 100, max: 2000 }).map(amt => bn(amt).mul(pow10(18)))

export const User = () => fc.integer(0, 4).map((n) => Users[n])

export const DAI = () =>
  fc.constant({
    name: 'DAI',
    symbol: 'DAI',
    decimals: 18,
  })

export const USDC = () =>
  fc.constant({
    name: 'USDC',
    symbol: 'USDC',
    decimals: 6,
  })

export const USDT = () =>
  fc.constant({
    name: 'USDT',
    symbol: 'USDT',
    decimals: 18,
  })

export const Tokens = () => fc.oneof(DAI(), USDC(), USDT())

export const BasketTokens = () =>
  fc.array(Tokens(), { maxLength: 6 }).filter((tokens) => {
    // basket tshould not be empty and tokens should be unique within a basket
    const tknSymbols = tokens.map(({ symbol }) => symbol)
    return tknSymbols.length > 0 && tknSymbols.length === new Set(tknSymbols).size
  })

export const Basket = () =>
  BasketTokens().map((tokens) => {
    // Only supports proportional distribution of weight for the moment
    const pct: string = (1 / tokens.length).toFixed(6) // assumes precision: 6 decimals
    const basket: Array<BasketTokenEntry> = []
    tokens.forEach((tkn) =>
      basket.push({
        name: tkn.name,
        symbol: tkn.symbol,
        quantityE18: ethers.utils.parseUnits(pct, tkn.decimals)//,
        //decimals: tkn.decimals,
      })
    )
    return basket
  })

export const Balances = () =>
  fc.dictionary(User(), bnUint256()).map((uBals) => {
    const userBalances: Map<Account, BigNumber> = new Map<Account, BigNumber>()
    for (const usr in uBals) {
      userBalances.set(usr as Account, uBals[usr])
    }
    return userBalances
  })

export const EmptyBalances = () => fc.constant(new Map<Account, BigNumber>())

export const State = () =>
  fc.record({
    rToken: fc.record({
      basket: Basket(),
      balances: EmptyBalances(),
    }),
  })

export const Commands = () => fc.array(UserCommand(), { minLength: 1, maxLength: 10 })

export const UserCommand = () => fc.tuple(User(), fc.oneof(IssueCommand(), RedeemCommand()))

export const IssueCommand = () =>
  fc.record({
    rToken: fc.record({
      issue: fc.tuple(simpleAmount),
    }),
  })

export const RedeemCommand = () =>
  fc.record({
    rToken: fc.record({
      redeem: fc.tuple(simpleAmount),
    }),
  })
