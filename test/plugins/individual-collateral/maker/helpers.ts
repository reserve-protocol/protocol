import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata, IWSTETH } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, GUNIV3DAIUSDC1_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintGUNIDAIUSCD = async (
  guni: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
    await guni.connect(tokenWhale).transfer(recipient, amount)
  })
}


export const resetFork = getResetFork(FORK_BLOCK)
