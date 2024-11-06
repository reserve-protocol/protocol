import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, SUSDS_HOLDER } from './constants'
import { getResetFork } from '../helpers'

export const mintSUSDS = async (
  susds: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(SUSDS_HOLDER, async (whale) => {
    await susds.connect(whale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
