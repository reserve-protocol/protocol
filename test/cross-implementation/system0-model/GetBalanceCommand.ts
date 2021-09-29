import { TokenCommand, TokenModel } from './TokenModel'
import { TokenCaller } from '../system1-evm/TokenCaller'
import { expect } from 'chai'

export class GetBalanceCommand implements TokenCommand {
  constructor() {}
  async check(m: TokenModel) {
    return true
  }
  async run(m: TokenModel, p: TokenCaller) {
    expect(await p.getBalance()).to.equal(m.balance)
    
    // Print output
    console.log(this.toString() + ` - ${await p.getBalance()} == ${m.balance}`)   
  }
  toString() {
    return `GETBALANCE()`
  }
}
