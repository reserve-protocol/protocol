import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ERC20Mock,
  CometInterface,
  ICometConfigurator,
  ICometProxyAdmin,
  ICusdcV3Wrapper,
  CusdcV3Wrapper__factory,
} from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { bn } from '../../../../common/numbers'
import { BigNumberish } from 'ethers'
import {
  USDC_HOLDER,
  USDC,
  COMET_CONFIGURATOR,
  COMET_PROXY_ADMIN,
  CUSDC_V3,
  REWARDS,
  COMP,
  FORK_BLOCK,
} from './constants'
import { getResetFork } from '../helpers'

export const enableRewardsAccrual = async (
  cusdcV3: CometInterface,
  baseTrackingSupplySpeed = bn('2e14')
) => {
  const governorAddr = await cusdcV3.governor()
  const configurator = <ICometConfigurator>(
    await ethers.getContractAt('ICometConfigurator', COMET_CONFIGURATOR)
  )

  await whileImpersonating(governorAddr, async (governor) => {
    await configurator
      .connect(governor)
      .setBaseTrackingSupplySpeed(cusdcV3.address, baseTrackingSupplySpeed)
    const proxyAdmin = <ICometProxyAdmin>(
      await ethers.getContractAt('ICometProxyAdmin', COMET_PROXY_ADMIN)
    )
    await proxyAdmin.connect(governor).deployAndUpgradeTo(configurator.address, cusdcV3.address)
  })
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

interface WrappedcUSDCFixture {
  cusdcV3: CometInterface
  wcusdcV3: ICusdcV3Wrapper
  usdc: ERC20Mock
}

export const mintWcUSDC = async (
  usdc: ERC20Mock,
  cusdc: CometInterface,
  wcusdc: ICusdcV3Wrapper,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  const initBal = await cusdc.balanceOf(account.address)

  // do these actions together to move rate as little as possible
  await hre.network.provider.send('evm_setAutomine', [false])
  const usdcAmount = await wcusdc.convertStaticToDynamic(amount)
  await allocateUSDC(account.address, usdcAmount)
  await usdc.connect(account).approve(cusdc.address, ethers.constants.MaxUint256)
  await cusdc.connect(account).allow(wcusdc.address, true)
  await hre.network.provider.send('evm_setAutomine', [true])

  await cusdc.connect(account).supply(usdc.address, usdcAmount)
  const nowBal = await cusdc.balanceOf(account.address)
  if (account.address == recipient) {
    await wcusdc.connect(account).deposit(nowBal.sub(initBal))
  } else {
    await wcusdc.connect(account).depositTo(recipient, nowBal.sub(initBal))
  }
}

export const makewCSUDC = async (): Promise<WrappedcUSDCFixture> => {
  const cusdcV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDC_V3)
  const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
    await ethers.getContractFactory('CusdcV3Wrapper')
  )
  const wcusdcV3 = <ICusdcV3Wrapper>(
    await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
  )
  const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)

  return { cusdcV3, wcusdcV3, usdc }
}

export const resetFork = getResetFork(FORK_BLOCK)
