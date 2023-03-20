import { ICToken, IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { getResetFork } from '../helpers'
import forkBlockNumber from '../../../integration/fork-block-numbers'

export const mintFToken = async (
  underlying: IERC20Metadata,
  holderUnderlying: string,
  fToken: ICToken,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(holderUnderlying, async (signer) => {
    const balUnderlying = await underlying.balanceOf(signer.address)
    await underlying.connect(signer).approve(fToken.address, balUnderlying)
    await fToken.connect(signer).mint(balUnderlying)
    await fToken.connect(signer).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(forkBlockNumber['flux-finance'])
