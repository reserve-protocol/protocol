import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IDieselToken } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, WETH_WHALE, DAI_WHALE, USDC_WHALE, FRAX_WHALE } from './constants'
import { getResetFork } from '../helpers'
import { ERC20Mock } from '../../../../typechain'
import { IPoolService } from '../../../../typechain/IPoolService'

export const resetFork = getResetFork(FORK_BLOCK)