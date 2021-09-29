import fc from 'fast-check'
import { TokenCaller } from '../system1-evm/TokenCaller'
import { BigNumber } from 'ethers'

export class TokenModel {
  balance = BigNumber.from(0)

  reset(): void {
    this.balance = BigNumber.from(0)
  }

  transfer(amount: BigNumber): void {
    this.balance = this.balance.add(amount)
  }
}

export type TokenCommand = fc.AsyncCommand<TokenModel, TokenCaller, true>
