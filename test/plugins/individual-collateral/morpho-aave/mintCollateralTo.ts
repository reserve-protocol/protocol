import { CollateralFixtureContext, MintCollateralFunc } from '../pluginTestTypes'
import hre from 'hardhat'
import { networkConfig } from '#/common/configuration'
import { BigNumberish, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { whileImpersonating } from '#/utils/impersonation'
import { IERC20 } from '@typechain/IERC20'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { MorphoAaveV2TokenisedDepositMock } from '@typechain/MorphoAaveV2TokenisedDepositMock'
import { getChainId } from '#/common/blockchain-utils'
import { Whales, getWhalesFile } from '#/scripts/whalesConfig'

/**
 * Interface representing the context object for the MorphoAaveCollateralFixture.
 * Extends the CollateralFixtureContext interface.
 * Contains the MorphoAAVEPositionWrapperMock contract and the underlying ERC20 token.
 */
export interface MorphoAaveCollateralFixtureContext extends CollateralFixtureContext {
  morphoWrapper: MorphoAaveV2TokenisedDepositMock
  underlyingErc20: IERC20
  targetPrRefFeed?: MockV3Aggregator
}

/**
 * Mint collateral to a recipient using the MorphoAAVEPositionWrapperMock contract.
 * @param ctx The MorphoAaveCollateralFixtureContext object.
 * @param amount The amount of collateral to mint.
 * @param _ The signer with address (not used in this function).
 * @param recipient The address of the recipient of the minted collateral.
 */
export const mintCollateralTo: MintCollateralFunc<MorphoAaveCollateralFixtureContext> = async (
  ctx: MorphoAaveCollateralFixtureContext,
  amount: BigNumberish,
  _: SignerWithAddress,
  recipient: string
) => {
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens
  whales[networkConfig['1'].tokens.USDC!.toLowerCase()] =
    '0xD6153F5af5679a75cC85D8974463545181f48772'

  await whileImpersonating(
    hre,
    whales[ctx.underlyingErc20.address.toLowerCase()],
    async (whaleSigner) => {
      await ctx.underlyingErc20.connect(whaleSigner).approve(ctx.morphoWrapper.address, 0)
      await ctx.underlyingErc20
        .connect(whaleSigner)
        .approve(ctx.morphoWrapper.address, constants.MaxUint256)
      await ctx.morphoWrapper.connect(whaleSigner).mint(amount, recipient)
    }
  )
}
