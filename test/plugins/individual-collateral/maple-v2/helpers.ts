import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { IERC20Metadata, IMaplePool } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
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

export const increaseTargetPerRef = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    const _latestRound = await ctx.chainlinkFeed.latestRoundData()
    const _nextAnswer = _latestRound.answer.add(_latestRound.answer.mul(pctIncrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(_nextAnswer)
}

export const reduceTargetPerRef = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
    const _latestRound = await ctx.chainlinkFeed.latestRoundData()
    const _nextAnswer = _latestRound.answer.sub(_latestRound.answer.mul(pctDecrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(_nextAnswer)
}

// {ref/tok} = totalAssets / totalSupply
// so we directly transfer underlying assets to the pool to increase {ref/tok}
export const increaseRefPerTokFactory = (underlying: string, holder: string) => {
    const _increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
        const _underlying = await ethers.getContractAt('IERC20Metadata', underlying)
        await whileImpersonating(holder, async (signer: SignerWithAddress) => {
            const _balance = await _underlying.balanceOf(ctx.tok.address) // pool balance
            const _amount = _balance.mul(pctIncrease).div(100)
            await _underlying.connect(signer).transfer(ctx.tok.address, _amount)
        })
    }
    return _increaseRefPerTok
}

// {ref/tok} = totalAssets / totalSupply
// so we directly transfer underlying assets from the pool to reduce {ref/tok}
export const reduceRefPerTokFactory = (underlying: string, recipient: string) => {
    const _reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
        const _underlying = await ethers.getContractAt('IERC20Metadata', underlying)
        await whileImpersonating(ctx.tok.address, async (signer: SignerWithAddress) => {
            const _balance = await _underlying.balanceOf(ctx.tok.address) // pool balance
            const _amount = _balance.mul(pctDecrease).div(100)
            await _underlying.connect(signer).transfer(recipient, _amount)
        })
    }
    return _reduceRefPerTok
}
