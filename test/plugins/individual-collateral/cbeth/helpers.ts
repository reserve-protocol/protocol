import { ethers } from 'hardhat'
import { ICBEth } from '../../../../typechain'
import { BigNumberish } from 'ethers'
import { CB_ETH, CB_ETH_BASE, CB_ETH_MINTER, CB_ETH_MINTER_BASE, FORK_BLOCK } from './constants'
import { getResetFork } from '../helpers'
import { whileImpersonating } from '#/utils/impersonation'
import hre from 'hardhat'
export const resetFork = getResetFork(FORK_BLOCK)

export const mintCBETH = async (amount: BigNumberish, recipient: string) => {
  const cbETH: ICBEth = <ICBEth>await ethers.getContractAt('ICBEth', CB_ETH)

  await whileImpersonating(hre, CB_ETH_MINTER, async (minter) => {
    await cbETH.connect(minter).configureMinter(CB_ETH_MINTER, amount)
    await cbETH.connect(minter).mint(recipient, amount)
  })
}

export const mintCBETHBase = async (amount: BigNumberish, recipient: string) => {
  const cbETH: ICBEth = <ICBEth>await ethers.getContractAt('ICBEth', CB_ETH_BASE)

  await whileImpersonating(hre, CB_ETH_MINTER_BASE, async (minter) => {
    await cbETH.connect(minter).mint(recipient, amount)
  })
}
