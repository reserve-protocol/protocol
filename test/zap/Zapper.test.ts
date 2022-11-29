import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, upgrades, waffle } from 'hardhat'
import { getChainId } from '../../common/blockchain-utils'
import { networkConfig } from '../../common/configuration'
import { bn, toBNDecimals } from '../../common/numbers'
import {
  Zapper,
  ZapLogicCDai,
  ZapLogicDai,
  TestIRToken,
  ERC20Mock,
  TestIMain,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'

const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const usdcWhale = '0xAe2D4617c862309A3d75A0fFB358c7a5009c673F'
const targetBasket = '0xc3ac2836FadAD8076bfB583150447a8629658591' // Frictionless

describe(`RToken Zapper Test V1`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  let chainId: number

  // Tokens/Assets
  let usdc: ERC20Mock

  // Core Contracts
  let rToken: TestIRToken

  before(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    chainId = await getChainId(hre)

    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', targetBasket)
  })

  it(`Should zap in`, async () => {
    // Deploy ZapLogic
    const ZapLogicDaiFactory: ContractFactory = await ethers.getContractFactory('ZapLogicDai')
    const zapLogicDai: ZapLogicDai = (await ZapLogicDaiFactory.deploy()) as ZapLogicDai
    await zapLogicDai.deployed()

    const ZapLogicCDaiFactory: ContractFactory = await ethers.getContractFactory('ZapLogicCDai')
    const zapLogicCDai: ZapLogicCDai = (await ZapLogicCDaiFactory.deploy()) as ZapLogicCDai
    await zapLogicCDai.deployed()

    // Deploy Zapper
    const ZapperFactory: ContractFactory = await ethers.getContractFactory('Zapper')
    const zapper: Zapper = (await ZapperFactory.deploy()) as Zapper
    await zapper.deployed()

    // Register ZapLogic
    await zapper.registerZapLogic(
      [networkConfig[chainId].tokens.DAI!, networkConfig[chainId].tokens.cDAI!],
      [zapLogicDai.address, zapLogicCDai.address]
    )

    const zapAmount = bn('1000e18')

    // Get USDC instance and rug
    usdc = (await ethers.getContractAt('ERC20Mock', usdcAddress)) as ERC20Mock
    await whileImpersonating(usdcWhale, async (whaleSigner) => {
      await usdc.connect(whaleSigner).transfer(owner.address, toBNDecimals(zapAmount, 6))
    })

    // Zap USDC into Frictionless Basket
    const rTokenBalanceBefore = await rToken.balanceOf(owner.address)
    console.log({ rTokenBalanceBefore })

    await usdc.connect(owner).approve(zapper.address, toBNDecimals(zapAmount, 6))
    await zapper.connect(owner).zapIn(targetBasket, usdc.address, toBNDecimals(zapAmount, 6))

    const rTokenBalanceAfter = await rToken.balanceOf(owner.address)

    console.log({ rTokenBalanceAfter })
    expect(rTokenBalanceAfter).to.be.gt(rTokenBalanceBefore)
  })
})
