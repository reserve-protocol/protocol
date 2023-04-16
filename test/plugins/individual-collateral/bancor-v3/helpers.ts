import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { IERC20Metadata, IPoolToken } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import { getResetFork } from '../helpers'
import { CollateralFixtureContext } from '../pluginTestTypes'
import { FORK_BLOCK } from './constants'

export const resetFork = getResetFork(FORK_BLOCK)

export const transferBnToken = async (holder: string, bnToken: IERC20Metadata, amount: BigNumberish, recipient: string) => {
    await whileImpersonating(holder, async (signer: SignerWithAddress) => {
        await bnToken.connect(signer).transfer(recipient, amount)
    })
}
export const getExpectedPriceFactory = (collection: string) => {
    const _getExpectedPrice = async (ctx: CollateralFixtureContext) => {
        const _collection = await ethers.getContractAt('IPoolCollection', collection)
        const _refPerTok = await _collection.poolTokenToUnderlying(
            await (ctx.tok as IPoolToken).reserveToken(),
            fp('1'))
        const _decimals = await ctx.chainlinkFeed.decimals()
        const _targetPerRef = await ctx.chainlinkFeed.latestRoundData()

        return _targetPerRef.answer.mul(bn(10).pow(18 - _decimals)).mul(_refPerTok).div(fp('1'))
    }
    return _getExpectedPrice
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
// transfering underlying tokens does not update the staked data on the pool (in the pool collection)
// the trick is to tamper with the totalSupply instead
export const increaseRefPerTokFactory = (holder: string) => {
    const _increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
        const _shares = await ctx.tok.totalSupply()
        const _amount = _shares.mul(pctIncrease).div(bn(100).add(pctIncrease))
        await whileImpersonating(holder, async (signer: SignerWithAddress) => {
            await (ctx.tok as IPoolToken).connect(signer).burn(_amount)
        })
    }
    return _increaseRefPerTok
}

// {ref/tok} = totalAssets / totalSupply
// transfering underlying tokens does not update the staked data on the pool (in the pool collection)
// the trick is to tamper with the totalSupply instead
export const reduceRefPerTokFactory = (holder: string, collection: string) => {
    const _reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
        const _shares = await ctx.tok.totalSupply()
        const _amount = _shares.mul(pctDecrease).div(bn(100).sub(pctDecrease))
        // the pool collection is actually the owner of the pool token
        await whileImpersonating(collection, async (signer: SignerWithAddress) => {
            await (ctx.tok as IPoolToken).connect(signer).mint(holder, _amount)
        })
    }
    return _reduceRefPerTok
}
