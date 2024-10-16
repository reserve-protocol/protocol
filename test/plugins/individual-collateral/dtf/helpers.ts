import { ethers } from 'hardhat'
import { IERC20Metadata } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK } from './constants'
import { getResetFork } from '../helpers'

export const mintPAXG = async (paxg: IERC20Metadata, amount: BigNumberish, recipient: string) => {
  const supplyControllerAddr = '0xE25a329d385f77df5D4eD56265babe2b99A5436e'

  await whileImpersonating(supplyControllerAddr, async (supplyController) => {
    const paxg2 = new ethers.Contract(paxg.address, [
      'function increaseSupply(uint256 _value) external returns (bool success)',
    ])

    await paxg2.connect(supplyController).increaseSupply(amount)
    await paxg.connect(supplyController).transfer(recipient, amount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
