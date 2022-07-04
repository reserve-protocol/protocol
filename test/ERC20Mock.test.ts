import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR } from '../common/constants'
import { bn, fp } from '../common/numbers'
import * as sc from '../typechain' // All smart contract types

describe(`ERC20Mock`, () => {
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let token: sc.ERC20Mock

  beforeEach(async () => {
    ;[owner, alice, bob] = await ethers.getSigners()
    const tokenFactory: sc.ERC20Mock__factory = await ethers.getContractFactory('ERC20Mock')
    token = await tokenFactory.deploy('ERC20Mock Token', 'M20')
  })

  it('allows minting', async () => {
    expect(await token.balanceOf(alice.address)).to.equal(0)
    await token.mint(alice.address, fp(3))
    expect(await token.balanceOf(alice.address)).to.equal(fp(3))
  })
  it('allows burning', async () => {})
  it('allows approval by admin', async () => {})
})
