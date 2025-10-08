import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IWeETH } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, WEETH_WHALE, LIQUIDITY_POOL, MEMBERSHIP_MANAGER } from './constants'
import { getResetFork } from '../helpers'
import { ethers } from 'hardhat'

export const mintWEETH = async (
  weETH: IWeETH,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  // transfer from a weETH whale
  await whileImpersonating(WEETH_WHALE, async (weEthWhale) => {
    await weETH.connect(weEthWhale).transfer(recipient, amount)
  })
}

/**
 * Simulate reward accrual in the Ether.fi protocol
 * This increases the weETH exchange rate by calling rebase() on the LiquidityPool
 */
export const accrueRewards = async (rewardAmount: BigNumberish) => {
  const liquidityPool = await ethers.getContractAt('ILiquidityPool', LIQUIDITY_POOL)

  // Call rebase() as the MembershipManager to accrue rewards
  await whileImpersonating(MEMBERSHIP_MANAGER, async (membershipManagerSigner) => {
    await liquidityPool.connect(membershipManagerSigner).rebase(rewardAmount)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
