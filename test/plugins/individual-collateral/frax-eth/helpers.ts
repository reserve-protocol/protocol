import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IfrxEthMinter } from '../../../../typechain'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, FRX_ETH_MINTER } from './constants'
import { getResetFork } from '../helpers'

export const mintsfrxETH = async (
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  const frxEthMinter: IfrxEthMinter = <IfrxEthMinter>(await ethers.getContractAt('IfrxEthMinter', FRX_ETH_MINTER))
  await frxEthMinter.connect(account).submitAndDeposit(recipient, {value: amount})
}

export const resetFork = getResetFork(FORK_BLOCK)
