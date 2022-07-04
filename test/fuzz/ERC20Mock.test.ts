import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import * as sc from '../../typechain' // All smart contract types

describe(`ERC20Mock`, () => {
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  let token: sc.ERC20Mock

  beforeEach(async () => {
    ;[owner, alice, bob, carol] = await ethers.getSigners()
    const tokenFactory: sc.ERC20Mock__factory = await ethers.getContractFactory('ERC20Mock')
    token = await tokenFactory.deploy('ERC20Mock Token', 'M20')

    expect(await token.balanceOf(alice.address)).to.equal(0)
    expect(await token.balanceOf(bob.address)).to.equal(0)
  })

  it('allows minting', async () => {
    await token.mint(alice.address, 23)
    expect(await token.balanceOf(alice.address)).to.equal(23)
  })

  it('allows burning', async () => {
    await token.mint(alice.address, 20)
    expect(await token.balanceOf(alice.address)).to.equal(20)
    await token.burn(alice.address, 7)
    expect(await token.balanceOf(alice.address)).to.equal(13)
    await token.burn(alice.address, 13)
    expect(await token.balanceOf(alice.address)).to.equal(0)
  })

  it('allows approval by admin', async () => {
    await token.mint(alice.address, 20)
    expect(await token.balanceOf(alice.address)).to.equal(20)
    await token.adminApprove(alice.address, bob.address, 15)
    await token.connect(bob).transferFrom(alice.address, carol.address, 15)
    expect(await token.balanceOf(alice.address)).to.equal(5)
    expect(await token.balanceOf(bob.address)).to.equal(0)
    expect(await token.balanceOf(carol.address)).to.equal(15)
  })
})
