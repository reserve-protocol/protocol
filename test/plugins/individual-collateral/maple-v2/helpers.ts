import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { IMaplePool } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import { getResetFork } from '../helpers'
import { CollateralFixtureContext } from '../pluginTestTypes'
import { FORK_BLOCK } from './constants'

export const resetFork = getResetFork(FORK_BLOCK)

export const mintMaplePoolToken = async (underlying: string, holder: string, mToken: string, amount: BigNumberish, recipient: string) => {
    const _underlying = await ethers.getContractAt('IERC20Metadata', underlying)
    const _pool = await ethers.getContractAt('IMaplePool', mToken)
    const _balance = await _underlying.balanceOf(holder)
    const _assets = await _pool.convertToAssets(amount) // the aim is to get "amount" number of shares by depositing assets
    await whileImpersonating(holder, async (signer: SignerWithAddress) => {
        await _underlying.connect(signer).approve(mToken, _balance)
        await _pool.connect(signer).deposit(_assets, recipient)
    })
}

export const transferMaplePoolToken = async (holder: string, mToken: IMaplePool, amount: BigNumberish, recipient: string) => {
    await whileImpersonating(holder, async (signer: SignerWithAddress) => {
        await mToken.connect(signer).transfer(recipient, amount)
    })
}

export const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const _refPerTok = await (ctx.tok as IMaplePool).convertToAssets(fp('1'))
    const _decimals = await ctx.chainlinkFeed.decimals()
    const _targetPerRef = await ctx.chainlinkFeed.latestRoundData()

    return _targetPerRef.answer.mul(bn(10).pow(18 - _decimals)).mul(_refPerTok).div(fp('1'))
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
        const _manager = await ethers.getContractAt('IPoolManager', await (ctx.tok as IMaplePool).manager())
        const _balance = await _manager.totalAssets()
        const _amount = _balance.mul(pctIncrease).div(100)
        await whileImpersonating(holder, async (signer: SignerWithAddress) => {
            await _underlying.connect(signer).transfer(ctx.tok.address, _amount)
        })
    }
    return _increaseRefPerTok
}

// {ref/tok} = totalAssets / totalSupply
// so we directly transfer underlying assets from the pool to reduce {ref/tok}
export const reduceRefPerTokFactory = (underlying: string, holder: string) => {
    const _reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
        const _underlying = await ethers.getContractAt('IERC20Metadata', underlying)
        const _manager = await ethers.getContractAt('IPoolManager', await (ctx.tok as IMaplePool).manager())
        const _balance = await _manager.totalAssets()
        const _amount = _balance.mul(pctDecrease).div(100)
        // deposit first to prevent the pool from running out of underlying tokens
        // most underlying tokens are lent, so the pool is relatively poor
        mintMaplePoolToken(underlying, holder, ctx.tok.address, _amount.mul(10), holder)
        // then move the underlying tokens out of the pool
        await whileImpersonating(ctx.tok.address, async (signer: SignerWithAddress) => {
            await _underlying.connect(signer).transfer(holder, _amount)
        })
    }
    return _reduceRefPerTok
}
