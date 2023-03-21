import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IAnkrETH } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, ANKRETH_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintAnkrETH = async (
  ankrETH: IAnkrETH,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  // transfer from an ankrEth whale
  await whileImpersonating(ANKRETH_WHALE, async (ankrEthWhale) => {
    await ankrETH.connect(ankrEthWhale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
