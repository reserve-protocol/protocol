import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20Metadata } from '#/typechain'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK } from './constants'
import { getResetFork } from '../helpers'
import { ethers } from 'hardhat'

export const mintMidasToken = async (
  midasToken: IERC20Metadata,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  const mockMToken = await ethers.getContractAt('MockMToken', midasToken.address)
  await mockMToken.connect(account).mint(recipient, amount)
}

export const resetFork = getResetFork(FORK_BLOCK)
