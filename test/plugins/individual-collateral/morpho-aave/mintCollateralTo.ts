import { CollateralFixtureContext, MintCollateralFunc } from '../pluginTestTypes'
import hre from 'hardhat'
import { BigNumberish, constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { networkConfig } from '#/common/configuration'
import { whales } from '#/tasks/testing/upgrade-checker-utils/constants'
import { whileImpersonating } from '#/utils/impersonation'
import { IERC20 } from '@typechain/IERC20'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { MorphoAaveV2TokenisedDepositMock } from '@typechain/MorphoAaveV2TokenisedDepositMock'

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

// TODO do we need this?
whales[networkConfig['1'].tokens.USDC!.toLowerCase()] = '0x756D64Dc5eDb56740fC617628dC832DDBCfd373c'

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
  console.log('mintCollateralTo', whales[ctx.underlyingErc20.address], whales)
  await whileImpersonating(hre, whales[ctx.underlyingErc20.address], async (whaleSigner) => {
    await ctx.underlyingErc20.connect(whaleSigner).approve(ctx.morphoWrapper.address, 0)
    await ctx.underlyingErc20
      .connect(whaleSigner)
      .approve(ctx.morphoWrapper.address, constants.MaxUint256)
    await ctx.morphoWrapper.connect(whaleSigner).mint(amount, recipient)
  })
}
