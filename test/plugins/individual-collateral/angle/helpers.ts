import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, stUSD_HOLDER, USDA_HOLDER } from './constants'
import { getResetFork } from '../helpers'

export const mintStUSD = async (
  stUSD: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(stUSD_HOLDER, async (whale) => {
    await stUSD.connect(whale).transfer(recipient, amount)
  })
}

export const mintUSDA = async (
  USDA: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(USDA_HOLDER, async (whale) => {
    await USDA.connect(whale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
