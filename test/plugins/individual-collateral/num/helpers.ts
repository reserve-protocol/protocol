import { whileImpersonating } from '#/utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, NUM_HOLDER } from './constants'
import { getResetFork } from '../helpers'
import { CollateralFixtureContext, MintCollateralFunc } from '../pluginTestTypes'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import hre, { ethers } from 'hardhat'

/**
 * Mint collateral to a recipient using a whale.
 * @param ctx The CollateralFixtureContext object.
 * @param amount The amount of collateral to mint.
 * @param _ The signer with address (not used in this function).
 * @param recipient The address of the recipient of the minted collateral.
 */
export const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
  ctx: CollateralFixtureContext,
  amount: BigNumberish,
  _: SignerWithAddress,
  recipient: string
) => {
  const tok = await ethers.getContractAt('MockNum4626', ctx.tok.address)

  // It can be a MockMetaMorpho4626 or the real ERC4626
  try {
    // treat it as a wrapper to begin
    const actual = await tok.actual()
    const underlying = await ethers.getContractAt('IERC20Metadata', actual)

    // Transfer the underlying (real) ERC4626; wrapper is pass-through
    await whileImpersonating(hre, NUM_HOLDER, async (whaleSigner) => {
      await underlying.connect(whaleSigner).transfer(recipient, amount)
    })
  } catch (e) {
    // if we error out, then it's not the wrapper we're dealing with
    await whileImpersonating(hre, NUM_HOLDER, async (whaleSigner) => {
      await ctx.tok.connect(whaleSigner).transfer(recipient, amount)
    })
  }
}

export const mintNARSTo: MintCollateralFunc<CollateralFixtureContext> = async (
  ctx: CollateralFixtureContext,
  amount: BigNumberish,
  _: SignerWithAddress,
  recipient: string
) => {
  // treat it as a wrapper to begin
  const underlying = await ethers.getContractAt('IERC20Metadata', ctx.tok.address)
  await whileImpersonating(hre, NUM_HOLDER, async (whaleSigner) => {
    await underlying.connect(whaleSigner).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
