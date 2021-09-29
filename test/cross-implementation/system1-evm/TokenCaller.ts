import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract, BigNumber } from 'ethers'
import { expect } from 'chai'
const hre = require('hardhat')

export interface TokenCaller {
  transfer(amount: BigNumber): Promise<void>
  getBalance(): Promise<BigNumber>
}

export class TokenCallerImplem implements TokenCaller {
  private token: Contract
  private minter: SignerWithAddress
  private recipient: SignerWithAddress

  constructor(token: Contract, minter: SignerWithAddress, recipient: SignerWithAddress) {
    this.token = token
    this.minter = minter
    this.recipient = recipient
  }

  async transfer(amount: BigNumber): Promise<void> {
    let balancePrev = await this.token.balanceOf(this.recipient.address)

    // Mint and Transfer
    await this.token.connect(this.minter).mint(this.minter.address, amount)
    await this.token.connect(this.minter).transfer(this.recipient.address, amount)

    // Check new balance
    expect(await this.token.balanceOf(this.recipient.address)).to.equal(balancePrev.add(amount))
  }

  async getBalance(): Promise<BigNumber> {
    const balance = await this.token.balanceOf(this.recipient.address)
    return balance
  }
}
