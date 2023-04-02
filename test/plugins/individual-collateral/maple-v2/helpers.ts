import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { IERC20Metadata, IMaplePool } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceBlocks } from '../../../utils/time'
import { getResetFork } from '../helpers'
import { CollateralFixtureContext } from '../pluginTestTypes'
import { FORK_BLOCK } from './constants'

export const resetFork = getResetFork(FORK_BLOCK)

export const mintMaplePoolToken = async (underlying: IERC20Metadata, holder: string, mToken: IMaplePool, amount: BigNumberish, recipient: string) => {
  await whileImpersonating(holder, async (signer: SignerWithAddress) => {
    const _balance = await underlying.balanceOf(signer.address)
    await underlying.connect(signer).approve(mToken.address, _balance)
    await mToken.connect(signer).deposit(amount, recipient)
  })
}

export const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
  const _refPerTok = await ctx.collateral.refPerTok()
  const _decimals = await ctx.chainlinkFeed.decimals()
  const _initData = await ctx.chainlinkFeed.latestRoundData()

  return _initData.answer.mul(bn(10).pow(18 - _decimals)).mul(_refPerTok).div(fp('1'))
}

export const increaseRefPerTok = async (ctx: CollateralFixtureContext) => {
  await advanceBlocks(1)
  await (ctx.tok as IMaplePool).convertToAssets(1e18)
}
