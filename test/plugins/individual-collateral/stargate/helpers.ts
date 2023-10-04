import { whileImpersonating } from '#/test/utils/impersonation'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '@typechain/ERC20Mock'
import {
  IStargatePool,
  IStargateRouter,
  StargateRewardableWrapper__factory,
  StargateRewardableWrapper,
} from '@typechain/index'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import {
  STAKING_CONTRACT,
  STARGATE,
  SUSDC,
  USDC,
  WSUSDC_NAME,
  WSUSDC_SYMBOL,
  USDC_HOLDER,
  FORK_BLOCK,
} from './constants'
import { getResetFork } from '../helpers'

interface WrappedstgUSDCFixture {
  usdc: ERC20Mock
  wstgUSDC: StargateRewardableWrapper
  stgUSDC: IStargatePool
  router: IStargateRouter
}

export const makewstgSUDC = async (susdc?: string): Promise<WrappedstgUSDCFixture> => {
  const stgUSDC = <IStargatePool>await ethers.getContractAt('IStargatePool', susdc ?? SUSDC)
  const router = <IStargateRouter>(
    await ethers.getContractAt('IStargateRouter', await stgUSDC.router())
  )

  const StargateRewardableWrapperFactory = <StargateRewardableWrapper__factory>(
    await ethers.getContractFactory('StargateRewardableWrapper')
  )
  const wstgUSDC = await StargateRewardableWrapperFactory.deploy(
    WSUSDC_NAME,
    WSUSDC_SYMBOL,
    STARGATE,
    STAKING_CONTRACT,
    stgUSDC.address
  )
  const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)

  return { stgUSDC, wstgUSDC, usdc, router }
}

const allocateERC20 = async (token: ERC20Mock, from: string, to: string, balance: BigNumberish) => {
  await whileImpersonating(from, async (signer) => {
    await token.connect(signer).transfer(to, balance)
  })
}

export const allocateUSDC = async (
  to: string,
  balance: BigNumberish,
  from: string = USDC_HOLDER,
  token: string = USDC
) => {
  const usdc = await ethers.getContractAt('ERC20Mock', token)

  await allocateERC20(usdc, from, to, balance)
}

export const mintWStgUSDC = async (
  usdc: ERC20Mock,
  susdc: IStargatePool,
  wsusdc: StargateRewardableWrapper,
  account: SignerWithAddress,
  amount: BigNumberish
) => {
  const router = <IStargateRouter>(
    await ethers.getContractAt('IStargateRouter', await susdc.router())
  )
  const initBal = await susdc.balanceOf(account.address)
  const usdcAmount = await susdc.amountLPtoLD(amount)

  await allocateUSDC(account.address, usdcAmount)

  await usdc.connect(account).approve(router.address, ethers.constants.MaxUint256)
  await susdc.connect(account).approve(wsusdc.address, ethers.constants.MaxUint256)

  await router.connect(account).addLiquidity(await susdc.poolId(), usdcAmount, account.address)

  const nowBal = await susdc.balanceOf(account.address)

  const realAmount = nowBal.sub(initBal)
  await wsusdc.connect(account).deposit(realAmount, account.address)

  return realAmount
}

export const resetFork = getResetFork(FORK_BLOCK)
