import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata, IWSTETH } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, GUNIV3DAIUSDC1_WHALE, WSTETH_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintWSTETH = async (
  wsteth: IWSTETH,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(WSTETH_WHALE, async (wstethWhale) => {
    await wsteth.connect(wstethWhale).transfer(recipient, amount)
  })
}

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
