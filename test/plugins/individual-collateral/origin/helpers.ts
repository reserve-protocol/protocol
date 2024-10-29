import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20 } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK_BASE, BASE_WSUPEROETHB_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintWSUPEROETHB = async (
  wsuperoethb: IERC20,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string,
  whale: string = BASE_WSUPEROETHB_WHALE
) => {
  await whileImpersonating(whale, async (wsuperoethbWhale) => {
    await wsuperoethb.connect(wsuperoethbWhale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK_BASE)
