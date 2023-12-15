import { IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, SFRAX_HOLDER } from './constants'
import { getResetFork } from '../helpers'

export const mintSFrax = async (sFrax: IERC20Metadata, amount: BigNumberish, recipient: string) => {
  await whileImpersonating(SFRAX_HOLDER, async (whale) => {
    await sFrax.connect(whale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
