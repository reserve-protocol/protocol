import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IBToken } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, bendWETH_WHALE } from './constants'
import { getResetFork } from '../helpers'

export const mintBendWETH = async (
    bendWETH: IBToken,
    account: SignerWithAddress,
    amount: BigNumberish,
    recipient: string
  ) => {
    // transfer from an bendWETH whale
    await whileImpersonating(bendWETH_WHALE, async (bendWETH_WHALE) => {
      await bendWETH.connect(bendWETH_WHALE).transfer(recipient, amount)
    })
  }
  

export const resetFork = getResetFork(FORK_BLOCK)