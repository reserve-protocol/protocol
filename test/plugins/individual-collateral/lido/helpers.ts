import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IWSTETH } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, WSTETH_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintWSTETH = async (
  wsteth: IWSTETH,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string,
  whale: string = WSTETH_WHALE
) => {
  await whileImpersonating(whale, async (wstethWhale) => {
    await wsteth.connect(wstethWhale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
