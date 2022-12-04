import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, upgrades, waffle } from 'hardhat'
import { getChainId } from '../../common/blockchain-utils'
import { networkConfig } from '../../common/configuration'
import { bn, toBNDecimals } from '../../common/numbers'
import {
  Zapper,
  ZapRouter,
  TestIRToken,
  ERC20Mock,
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
    // Deploy ZapRouter
    const ZapRouterFactory: ContractFactory = await ethers.getContractFactory('ZapRouter')
    const zapRouterLogic: ZapRouter = (await ZapRouterFactory.deploy([
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    ], 50)) as ZapRouter;
    const router = await zapRouterLogic.deployed();

    // Deploy Zapper
    const ZapperFactory: ContractFactory = await ethers.getContractFactory('Zapper')
    const zapper: Zapper = (await ZapperFactory.deploy(router.address)) as Zapper
    await zapper.deployed()

    const zapAmount = bn('1000e18')

    // Get USDC instance and rug
    usdc = (await ethers.getContractAt('ERC20Mock', usdcAddress)) as ERC20Mock
    await whileImpersonating(usdcWhale, async (whaleSigner) => {
      await usdc.connect(whaleSigner).transfer(owner.address, toBNDecimals(zapAmount, 6))
    })

    // Zap USDC into Frictionless Basket
    const rTokenBalanceBefore = await rToken.balanceOf(owner.address)
    const usdcBalanceBefore = await usdc.balanceOf(owner.address)
    console.log({ rTokenBalanceBefore, usdcBalanceBefore })

    await usdc.connect(owner).approve(zapper.address, toBNDecimals(zapAmount, 6))
    await zapper.connect(owner).zapIn(usdc.address, targetBasket, toBNDecimals(zapAmount, 6))

    const rTokenBalanceAfter = await rToken.balanceOf(owner.address)

    console.log({ rTokenBalanceAfter })
    expect(rTokenBalanceAfter).to.be.gt(rTokenBalanceBefore)
  })
})
