import { BEND_WETH, FORK_BLOCK, LENDPOOL, WETH, WETH_WHALE } from './constants'
import { getResetFork } from '../helpers'
import {
  IBToken,
  StaticBTokenLM__factory,
  IStaticBTokenLM,
  IERC20,
  WETH9,
  IStaticBToken,
} from '../../../../typechain'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { whileImpersonating } from '../../../utils/impersonation'

export const resetFork = getResetFork(FORK_BLOCK)

interface Fixture {
  tok: IStaticBToken
  staticBendWeth: IStaticBTokenLM
  bendWeth: IBToken
  weth: WETH9
}

export const makeStaticBendWeth = async (): Promise<Fixture> => {
  const weth = <WETH9>await ethers.getContractAt('WETH9', WETH)
  const bendWeth = <IBToken>await ethers.getContractAt('IBToken', BEND_WETH)
  const staticBTokenFactory = <StaticBTokenLM__factory>(
    await ethers.getContractFactory('StaticBTokenLM')
  )
  const tok = <IStaticBToken>(
    await staticBTokenFactory.deploy(LENDPOOL, bendWeth.address, 'Static Bend WETH', 'sBendWETH')
  )
  const staticBendWeth = <IStaticBTokenLM>await ethers.getContractAt('IStaticBTokenLM', tok.address)

  return { tok, staticBendWeth, bendWeth, weth }
}

export const mintStaticBendWeth = async (
  weth: IERC20,
  staticBendWeth: IStaticBTokenLM,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  // const dynamicAmount = await staticBendWeth.staticToDynamicAmount(amount)
  // await whileImpersonating(WETH_WHALE, async (wethWhale) => {
  //   await weth.connect(wethWhale).approve(staticBendWeth.address, dynamicAmount)
  //   await staticBendWeth.connect(wethWhale).deposit(recipient, dynamicAmount, 0, true)
  // })
  
  const dynamicAmount = await staticBendWeth.staticToDynamicAmount(amount)
  await whileImpersonating(WETH_WHALE, async (wethWhale) => {
    await weth.connect(wethWhale).approve(staticBendWeth.address, dynamicAmount)
    await staticBendWeth.connect(wethWhale).deposit(recipient, dynamicAmount, 0, true)
  })
}
