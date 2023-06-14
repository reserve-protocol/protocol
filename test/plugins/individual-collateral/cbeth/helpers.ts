import { ethers } from 'hardhat'
import { CBEth } from '../../../../typechain'
import { BigNumberish } from 'ethers'
import { CB_ETH_MINTER, CB_ETH, FORK_BLOCK } from './constants'
import { impersonateAccount } from '@nomicfoundation/hardhat-network-helpers'
import { getResetFork } from '../helpers'

export const resetFork = getResetFork(FORK_BLOCK)

export const mintCBETH = async (
    amount: BigNumberish,
    recipient: string,
) => {
    const cbETH: CBEth = <CBEth>(
        await ethers.getContractAt('CBEth', CB_ETH)
    )
    await impersonateAccount(
        CB_ETH_MINTER
    )
    const minter = ethers.provider.getSigner(
        CB_ETH_MINTER
    )
    await cbETH.connect(minter).mint(recipient, amount)
}
