import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK_ARBITRUM, ARB_WUSDM_HOLDER, ARB_USDM_HOLDER } from './constants'
import { getResetFork } from '../helpers'

export const mintWUSDM = async (
  wusdm: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(ARB_WUSDM_HOLDER, async (whale) => {
    await wusdm.connect(whale).transfer(recipient, amount)
  })
}

export const mintUSDM = async (
  usdm: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(ARB_USDM_HOLDER, async (whale) => {
    await usdm.connect(whale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK_ARBITRUM)
