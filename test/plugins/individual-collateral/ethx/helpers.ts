import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IETHx } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, ETHx_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintETHx = async (
  ethx: IETHx,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(ETHx_WHALE, async (ethxWhale) => {
    await ethx.connect(ethxWhale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
