import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, sUSDe_HOLDER, USDe_HOLDER } from './constants'
import { getResetFork } from '../helpers'

export const mintSUSDe = async (
  sUSDe: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(sUSDe_HOLDER, async (whale) => {
    await sUSDe.connect(whale).transfer(recipient, amount)
  })
}

export const mintUSDe = async (
  USDe: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(USDe_HOLDER, async (whale) => {
    await USDe.connect(whale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
