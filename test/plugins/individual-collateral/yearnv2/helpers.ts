import { ethers } from 'hardhat'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import {
  FORK_BLOCK,
  yvCurveUSDCcrvUSD,
  yvCurveUSDPcrvUSD,
  YVUSDC_HOLDER,
  YVUSDP_HOLDER,
} from './constants'
import { getResetFork } from '../helpers'

export const mintYToken = async (yTokenAddr: string, amount: BigNumberish, recipient: string) => {
  const yToken = await ethers.getContractAt('ERC20Mock', yTokenAddr)
  if (yTokenAddr == yvCurveUSDCcrvUSD) {
    await whileImpersonating(YVUSDC_HOLDER, async (whale) => {
      await yToken.connect(whale).transfer(recipient, amount)
    })
  } else if (yTokenAddr == yvCurveUSDPcrvUSD) {
    await whileImpersonating(YVUSDP_HOLDER, async (whale) => {
      await yToken.connect(whale).transfer(recipient, amount)
    })
  } else {
    throw new Error('yToken not supported')
  }
}

export const resetFork = getResetFork(FORK_BLOCK)
