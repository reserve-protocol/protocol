import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  WETH9,
  IReth
} from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import {
  WETH,
  FORK_BLOCK,
} from './constants'
import { getResetFork } from '../helpers'

const allocateWeth = async (account: string, amount: BigNumberish) => {
  const weth = await ethers.getContractAt('WETH9', WETH)
  await whileImpersonating(account, async (signer) => {
    await weth.connect(signer).deposit({value: amount})
  })
}

export const mintRETH = async (
  weth: WETH9,
  reth: IReth,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  // do these actions together to move rate as little as possible
  await hre.network.provider.send('evm_setAutomine', [false])
  await allocateWeth(account.address, amount)
  await weth.connect(account).approve(reth.address, amount)
  await reth.connect(account).mint(amount, account.address)
  await hre.network.provider.send('evm_setAutomine', [true])
  if (account.address != recipient) {
    reth.connect(account).transfer(recipient, amount)
  }
}

export const resetFork = getResetFork(FORK_BLOCK)
