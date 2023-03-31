import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { IERC20Metadata, IMaplePool } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { getResetFork } from '../../../plugins/individual-collateral/helpers'
import { FORK_BLOCK } from './constants'

export const mintMaplePoolToken = async (
  underlying: IERC20Metadata,
  holder: string,
  mToken: IMaplePool,
  amount: BigNumberish,
  recipient: string
) => {
  await whileImpersonating(holder, async (signer: SignerWithAddress) => {
    const balUnderlying = await underlying.balanceOf(signer.address)
    await underlying.connect(signer).approve(mToken.address, balUnderlying)
    await mToken.connect(signer).deposit(amount, recipient)
  })
}

export const resetFork = getResetFork(FORK_BLOCK)
