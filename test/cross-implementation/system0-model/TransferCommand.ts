import { TokenCommand, TokenModel } from './TokenModel'
import { TokenCaller } from '../system1-evm/TokenCaller'
import { BigNumber } from 'ethers'
import { expect } from 'chai'
import { MAX_UINT256 } from '../../../common/constants'

export class TransferCommand implements TokenCommand {
  constructor(readonly amount: BigNumber) {}
  async check(m: TokenModel) {
    // Protect against overflow
    if (m.balance.add(this.amount).gte(MAX_UINT256)) {
      return false
    }
    return true
  }
  async run(m: TokenModel, p: TokenCaller) {
    const currentBalance = await p.getBalance()
    expect(currentBalance).to.equal(m.balance)

    // Perform operations on model and blockchain
    m.transfer(this.amount)
    await p.transfer(this.amount)

    expect(await p.getBalance()).to.equal(m.balance)

    // Print output
    console.log(this.toString())
  }
  toString() {
    return `TRANSFER("${this.amount}")`
  }
}
