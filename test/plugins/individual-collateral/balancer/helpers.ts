import { WETH_WHALE } from './constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BPool, IERC20Metadata, WETH9 } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, BWETHDAI_WHALE, BWETHDAI } from './constants'
import { getResetFork } from '../helpers'
import { ethers } from 'hardhat'

export const mintBWETHDAI = async (
  bwethdai: BPool,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(BWETHDAI_WHALE, async (bWethDaiWhale) => {
    await bwethdai.connect(bWethDaiWhale).transfer(recipient, amount)
  })
}

export const transferWETH = async (
  weth: WETH9,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(WETH_WHALE, async (WETH_WHALE) => {
    await weth.connect(WETH_WHALE).transfer(recipient, amount)
  })
}

export const getBWethDaiPool = async () => {
  const bwethdai = (await ethers.getContractAt('BPool', BWETHDAI)) as BPool
  return { bwethdai }
}

export const resetFork = getResetFork(FORK_BLOCK)
