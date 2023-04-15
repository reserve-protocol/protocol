import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK} from './constants'
import { getResetFork } from '../helpers'

// export const mintRETH = async (
//   reth: IReth,
//   account: SignerWithAddress,
//   amount: BigNumberish,
//   recipient: string
// ) => {
//   // RETH is currently being flashbotted to reach the deposit ceiling
//   // transfer from a reth whale instead of depositing
//   await whileImpersonating(RETH_WHALE, async (rethWhale) => {
//     await reth.connect(rethWhale).transfer(recipient, amount)
//   })
// }

export const resetFork = getResetFork(FORK_BLOCK)
