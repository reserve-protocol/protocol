import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IApxETH, ERC20Mock } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, APXETH_WHALE, PXETH_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintAPXETH = async (
  apxETH: IApxETH,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  // transfer from an apxETH whale instead of depositing
  await whileImpersonating(APXETH_WHALE, async (apxEthWhale) => {
    await apxETH.connect(apxEthWhale).transfer(recipient, amount)
  })
}

export const mintPxETH = async (
  pxETH: ERC20Mock,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  // transfer from a pxETH whale instead of depositing
  await whileImpersonating(PXETH_WHALE, async (pxEthWhale) => {
    await pxETH.connect(pxEthWhale).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
