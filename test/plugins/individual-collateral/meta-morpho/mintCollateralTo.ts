import { networkConfig } from '#/common/configuration'
import { CollateralFixtureContext, MintCollateralFunc } from '../pluginTestTypes'
import hre, { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { whileImpersonating } from '#/utils/impersonation'

export const whales: { [key: string]: string } = {
  [networkConfig['31337'].tokens.steakUSDC!]: '0xC977d218Fde6A39c7aCE71C8243545c276B48931',
  [networkConfig['31337'].tokens.steakPYUSD!]: '0x7E4B4DC22111B84594d9b7707A8DCFFd793D477A',
  [networkConfig['31337'].tokens.bbUSDT!]: '0xc8E3C36a72B9AA4Af0a057eb4A11e1AFC16465bB',
  [networkConfig['31337'].tokens.Re7WETH!]: '0xd553294B42bdFEb49D8f5A64E8B2D3A65fc673A9',
  [networkConfig['8453'].tokens.meUSD!]: '0xF02ea73c7A3057649f09899aaE1606712758bE8b',
  // Morpho Vault V2 share whales (mainnet, verified holding at block 25250000)
  [networkConfig['31337'].tokens.steakUSDCPrime!]: '0x087e2aac2e2457a5107700a58543e35ff63391b4',
  [networkConfig['31337'].tokens.sentoraPYUSD!]: '0x75381e9bc6b908a2e9bc31a535fc48ceceac568e',
  [networkConfig['31337'].tokens.gauntletUSDCFrontier!]:
    '0x3bd9248048df95db4fbd748c6cd99c1baa40bad0',
  [networkConfig['31337'].tokens.steakUSDTPrime!]: '0xffff8e7c98fc62dde2081825e7556b05717159c9',
  [networkConfig['31337'].tokens.galaxyUSDTQuality!]: '0xaac7519736532f7731d1b01b0221c8a0959dd0fe',
  [networkConfig['31337'].tokens.gauntletUSDCPrime!]: '0xd8b444ac665b0de3a9135ad7be1a45f88ac97b3c',
  [networkConfig['31337'].tokens.galaxyUSDCQuality!]: '0xff43c5727fbfc31cb96e605dfd7546eb8862064c',
  [networkConfig['31337'].tokens.skyUSDTSavings!]: '0xb6a40866b80074e478d349c0aa5ddeb47405fd06',
}

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
  const tok = await ethers.getContractAt('MockMetaMorpho4626', ctx.tok.address)

  // It can be a MockMetaMorpho4626 or the real ERC4626
  try {
    // treat it as a wrapper to begin
    const underlying = await ethers.getContractAt('IERC20Metadata', await tok.actual())

    // Transfer the underlying (real) ERC4626; wrapper is pass-through
    await whileImpersonating(hre, whales[underlying.address], async (whaleSigner) => {
      await underlying.connect(whaleSigner).transfer(recipient, amount)
    })
  } catch {
    // if we error out, then it's not the wrapper we're dealing with
    await whileImpersonating(hre, whales[ctx.tok.address], async (whaleSigner) => {
      await ctx.tok.connect(whaleSigner).transfer(recipient, amount)
    })
  }
}
