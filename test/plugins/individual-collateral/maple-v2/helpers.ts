import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { IERC20Metadata, IMaplePool } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceBlocks } from '../../../utils/time'
import { getResetFork } from '../helpers'
import { CollateralFixtureContext } from '../pluginTestTypes'
import { FORK_BLOCK, REVENUE_HIDING } from './constants'

export const resetFork = getResetFork(FORK_BLOCK)

export const mintMaplePoolToken = async (underlying: IERC20Metadata, holder: string, mToken: IMaplePool, amount: BigNumberish, recipient: string) => {
    await whileImpersonating(holder, async (signer: SignerWithAddress) => {
        const _balance = await underlying.balanceOf(signer.address)
        const _assets = await mToken.convertToAssets(amount) // the aim is to get "amount" number of shares by depositing assets
        await underlying.connect(signer).approve(mToken.address, _balance)
        await mToken.connect(signer).deposit(_assets, recipient)
    })
}

export const transferMaplePoolToken = async (holder: string, mToken: IMaplePool, amount: BigNumberish, recipient: string) => {
    await whileImpersonating(holder, async (signer: SignerWithAddress) => {
        await mToken.connect(signer).transfer(recipient, amount)
    })
}

export const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const _exposedRefPerTok = await ctx.collateral.refPerTok()
    const _revenueShowingInv = fp('1').mul(fp('1')).div(fp('1').sub(REVENUE_HIDING))
    const _strictRefPerTok = _exposedRefPerTok.mul(_revenueShowingInv).div(fp('1'))
    const _decimals = await ctx.chainlinkFeed.decimals()
    const _targetPerRef = await ctx.chainlinkFeed.latestRoundData()

    return _targetPerRef.answer.mul(bn(10).pow(18 - _decimals)).mul(_strictRefPerTok).div(fp('1'))
}

export const reduceTargetPerRef = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
    const _latestRound = await ctx.chainlinkFeed.latestRoundData()
    const _nextAnswer = _latestRound.answer.sub(_latestRound.answer.mul(pctDecrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(_nextAnswer)
}

export const increaseTargetPerRef = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    const _latestRound = await ctx.chainlinkFeed.latestRoundData()
    const _nextAnswer = _latestRound.answer.add(_latestRound.answer.mul(pctIncrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(_nextAnswer)
}

export const increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    await advanceBlocks(1)
}
