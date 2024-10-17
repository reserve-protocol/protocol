import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ERC20Mock,
  CometInterface,
  ICometConfigurator,
  ICometProxyAdmin,
  ICFiatV3Wrapper,
  CFiatV3Wrapper__factory,
} from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { bn, fp } from '../../../../common/numbers'
import { BigNumberish } from 'ethers'
import {
  USDC,
  USDT,
  USDC_USD_PRICE_FEED,
  USDT_USD_PRICE_FEED,
  COMET_CONFIGURATOR,
  COMET_PROXY_ADMIN,
  CUSDC_V3,
  CUSDT_V3,
  REWARDS,
  COMP,
  getHolder,
} from './constants'

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

export const allocateToken = async (
  to: string,
  balance: BigNumberish,
  from: string,
  token: string
) => {
  const erc20 = await ethers.getContractAt('ERC20Mock', token)
  await allocateERC20(erc20, from, to, balance)
}

export interface WrappedCTokenFixture {
  cTokenV3: CometInterface
  wcTokenV3: ICFiatV3Wrapper
  token: ERC20Mock
}

export const mintWcToken = async (
  token: ERC20Mock,
  cTokenV3: CometInterface,
  wcTokenV3: ICFiatV3Wrapper,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  const initBal = await cTokenV3.balanceOf(account.address)

  // do these actions together to move rate as little as possible
  await hre.network.provider.send('evm_setAutomine', [false])
  const tokenAmount = await wcTokenV3.convertStaticToDynamic(amount)
  await allocateToken(account.address, tokenAmount, getHolder(await token.symbol()), token.address)
  await token.connect(account).approve(cTokenV3.address, ethers.constants.MaxUint256)
  await cTokenV3.connect(account).allow(wcTokenV3.address, true)
  await hre.network.provider.send('evm_setAutomine', [true])

  await cTokenV3.connect(account).supply(token.address, tokenAmount)
  const nowBal = await cTokenV3.balanceOf(account.address)
  if (account.address == recipient) {
    await wcTokenV3.connect(account).deposit(nowBal.sub(initBal))
  } else {
    await wcTokenV3.connect(account).depositTo(recipient, nowBal.sub(initBal))
  }
}

export const makewCSUDC = async (): Promise<WrappedCTokenFixture> => {
  const cusdcV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDC_V3)
  const CTokenV3WrapperFactory = <CFiatV3Wrapper__factory>(
    await ethers.getContractFactory('CFiatV3Wrapper')
  )
  const wcusdcV3 = <ICFiatV3Wrapper>(
    await CTokenV3WrapperFactory.deploy(
      cusdcV3.address,
      REWARDS,
      COMP,
      'Wrapped cUSDCv3',
      'wcUSDCv3',
      fp('1')
    )
  )
  const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)

  return { cTokenV3: cusdcV3, wcTokenV3: wcusdcV3, token: usdc }
}

export const makewCSUDT = async (): Promise<WrappedCTokenFixture> => {
  const cusdtV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDT_V3)
  const CTokenV3WrapperFactory = <CFiatV3Wrapper__factory>(
    await ethers.getContractFactory('CFiatV3Wrapper')
  )
  const wcusdtV3 = <ICFiatV3Wrapper>(
    await CTokenV3WrapperFactory.deploy(
      cusdtV3.address,
      REWARDS,
      COMP,
      'Wrapped cUSDTv3',
      'wcUSDTv3',
      fp('1')
    )
  )
  const usdt = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDT)

  return { cTokenV3: cusdtV3, wcTokenV3: wcusdtV3, token: usdt }
}

// Test configuration
export interface CTokenV3Enumeration {
  testName: string
  forkNetwork: string
  wrapperName: string
  wrapperSymbol: string
  cTokenV3: string
  token: string
  tokenName: string
  chainlinkFeed: string
  fix: typeof makewCSUDC
}

const cUSDCv3 = {
  testName: 'CompoundV3USDC',
  wrapperName: 'Wrapped cUSDCv3',
  wrapperSymbol: 'wcUSDCv3',
  cTokenV3: CUSDC_V3,
  token: USDC,
  tokenName: 'USDC',
  chainlinkFeed: USDC_USD_PRICE_FEED,
  fix: makewCSUDC,
}

const cUSDTv3 = {
  testName: 'CompoundV3USDT',
  wrapperName: 'Wrapped cUSDTv3',
  wrapperSymbol: 'wcUSDTv3',
  cTokenV3: CUSDT_V3,
  token: USDT,
  tokenName: 'USDT',
  chainlinkFeed: USDT_USD_PRICE_FEED,
  fix: makewCSUDT,
}

export const allTests = [
  { ...cUSDCv3, forkNetwork: 'mainnet' },
  { ...cUSDCv3, forkNetwork: 'base' },
  { ...cUSDCv3, forkNetwork: 'arbitrum' },
  { ...cUSDTv3, forkNetwork: 'mainnet' },
  { ...cUSDTv3, forkNetwork: 'arbitrum' },
]
