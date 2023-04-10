import { BEND_WETH, FORK_BLOCK, LENDPOOL, WETH, WETH_WHALE } from './constants'
import { getResetFork } from '../helpers'
import {
  IAToken,
  StaticATokenLM__factory,
  IStaticATokenLM,
  IERC20,
  IERC20Metadata,
  WETH9,
} from '../../../../typechain'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { whileImpersonating } from '../../../utils/impersonation'

export const resetFork = getResetFork(FORK_BLOCK)

interface Fixture {
  tok: IERC20Metadata
  sBendWeth: IStaticATokenLM
  bendWeth: IAToken
  weth: WETH9
}

export const makeStaticBendWeth = async (): Promise<Fixture> => {
  const weth = <WETH9>await ethers.getContractAt('WETH9', WETH)
  const bendWeth = <IAToken>await ethers.getContractAt('IAToken', BEND_WETH)
  const staticATokenFactory = <StaticATokenLM__factory>(
    await ethers.getContractFactory('StaticATokenLM')
  )
  const sBendWeth = <IStaticATokenLM>(
    await staticATokenFactory.deploy(LENDPOOL, bendWeth.address, 'Static Bend WETH', 'sBendWETH')
  )
  const tok = <IERC20Metadata>await ethers.getContractAt('IERC20Metadata', sBendWeth.address)

  return { tok, sBendWeth, bendWeth, weth }
}

export const mintStaticBendWeth = async (
  weth: IERC20,
  sBendWeth: IStaticATokenLM,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  const dynamicAmount = await sBendWeth.staticToDynamicAmount(amount)
  await whileImpersonating(WETH_WHALE, async (wethWhale) => {
    await weth.connect(wethWhale).approve(sBendWeth.address, dynamicAmount)
    await sBendWeth.connect(wethWhale).deposit(recipient, dynamicAmount, 0, true)
  })
}
