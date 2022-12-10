import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { bn, toBNDecimals } from '../../common/numbers'
import {
  Zapper,
  ZapRouter,
  TestIRToken,
  ERC20Mock,
  CompoundRouterAdapter,
  StaticAaveRouterAdapter,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'

interface TestTokenParams {
  address: string
  whale: string
  amountOverride?: BigNumber | undefined
}

interface TestResultTableData {
  from: string
  tokenAmount: string
  to: string
  rTokenAmount: string
  redeemAmount: string
  efficiency: string
}

interface TestTokenParams {
  address: string
  whale: string
  amountOverride?: BigNumber | undefined
}

function formatBalance(amount: BigNumberish, decimals = 18): number {
  return Number(ethers.utils.formatUnits(amount, decimals))
}

const testTokens: TestTokenParams[] = [
  // WBTC
  {
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    whale: '0x218b95be3ed99141b0144dba6ce88807c4ad7c09',
    amountOverride: bn('5e17'),
  },
  // WETH
  {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    whale: '0xf584F8728B874a6a5c7A8d4d387C9aae9172D621',
    amountOverride: bn('1e18'),
  },
  // USDC
  {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    whale: '0xAe2D4617c862309A3d75A0fFB358c7a5009c673F',
  },
  // DAI
  {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    whale: '0x075e72a5edf65f0a5f44699c7654c1a76941ddc8',
  },
  // USDT
  {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    whale: '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
  },
  // BUSD
  {
    address: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
    whale: '0xf977814e90da44bfa03b6295a0616a897441acec',
  },
  // FRAX
  {
    address: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
    whale: '0xdcef968d416a41cdac0ed8702fac8128a64241a2',
  },
]

const staticAaveBasket = '0xAf48c99b3b4E47286dac9E53E091b70536CB4373'

const testBaskets = [
  // Aave Token
  staticAaveBasket,
  // Frictionless Auction Token
  '0xc3ac2836FadAD8076bfB583150447a8629658591',
  // Bogota Test
  '0xcEC59484A59e0EE908B25Ae6C9e2FeC43c012bbD',
  // RUSD
  '0xe2822bbB0c962aAce905773b15adf50706258A8A',
]

describe(`RToken Zapper Test V1`, () => {
  const acquireAmount = bn('10000e18')

  let owner: SignerWithAddress
  let other: SignerWithAddress

  // Core Contracts
  let router: ZapRouter
  let compoundRouterAdapter: CompoundRouterAdapter
  let staticAaveRouterAdapter: StaticAaveRouterAdapter
  let zapper: Zapper
  let rToken: TestIRToken

  const setup = async (blockNumber: number) => {
    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_RPC_URL,
            blockNumber: blockNumber,
          },
        },
      ],
    })
  }

  async function setupTest(targetBasket: string) {
    await setup(targetBasket === staticAaveBasket ? 15719898 : 16077247)

    // Deploy ZapRouter
    const ZapRouterFactory: ContractFactory = await ethers.getContractFactory('ZapRouter')
    const zapRouterDeploy: ZapRouter = (await ZapRouterFactory.deploy(200)) as ZapRouter
    router = await zapRouterDeploy.deployed()

    const CompoundRouterAdapterFactory: ContractFactory = await ethers.getContractFactory(
      'CompoundRouterAdapter'
    )
    const compoundRouterAdapterDeploy: CompoundRouterAdapter =
      (await CompoundRouterAdapterFactory.deploy()) as CompoundRouterAdapter
    compoundRouterAdapter = await compoundRouterAdapterDeploy.deployed()
    await router.registerAdapter(compoundRouterAdapter.address)

    const StaticAaveRouterAdapterFactory: ContractFactory = await ethers.getContractFactory(
      'StaticAaveRouterAdapter'
    )
    const staticAaveRouterAdapterDeploy: StaticAaveRouterAdapter =
      (await StaticAaveRouterAdapterFactory.deploy([
        '0x064746E7E8f44b41773B6377A38b5b2ebeD73349',
      ])) as StaticAaveRouterAdapter
    staticAaveRouterAdapter = await staticAaveRouterAdapterDeploy.deployed()
    await router.registerAdapter(staticAaveRouterAdapter.address)

    // Deploy Zapper
    const ZapperFactory: ContractFactory = await ethers.getContractFactory('Zapper')
    const zapperDeploy: Zapper = (await ZapperFactory.deploy(router.address)) as Zapper
    zapper = await zapperDeploy.deployed()
  }

  before(async () => {
    ;[owner, other] = await ethers.getSigners()
  })

  it(`Zaps in various stable coins to various rTokens`, async () => {
    const testData: TestResultTableData[] = []
    for (const input of testTokens) {
      const { address, whale, amountOverride } = input
      for (const targetBasket of testBaskets) {
        await setupTest(targetBasket)
        const result = await verifyMint(
          address,
          whale,
          amountOverride || acquireAmount,
          targetBasket
        )
        testData.push(result)
      }
    }
    console.table(testData)
  })

  async function verifyMint(
    purchaseToken: string,
    whale: string,
    acquireAmount: BigNumber,
    targetBasket: string
  ): Promise<TestResultTableData> {
    console.log(`${purchaseToken} -> ${targetBasket}`)
    const token = (await ethers.getContractAt('ERC20Mock', purchaseToken)) as ERC20Mock
    const [decimals, tokenName] = await Promise.all([token.decimals(), token.name()])
    await whileImpersonating(whale, async (signer) => {
      await token.connect(signer).transfer(owner.address, toBNDecimals(acquireAmount, decimals))
    })
    const convertedSpend = toBNDecimals(acquireAmount, decimals)
    await token.connect(owner).approve(zapper.address, convertedSpend)

    // current static aave test basket is paused and keys burned
    if (targetBasket == staticAaveBasket) {
      const OWNER = '0xf7bd1f8fde9fbdc8436d45594e792e014c5ac966' // Facade Writer
      const MAIN_ADDRESS = '0x80403bB991A76908Daea5A4330aEe5B4073F96c4'
      const MAIN_ABI = ['function unpause()']
      await whileImpersonating(OWNER, async (signer) => {
        await (await ethers.getContractAt(MAIN_ABI, MAIN_ADDRESS)).connect(signer).unpause()
      })
    }

    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', targetBasket)
    const rTokenBalanceBefore = await rToken.balanceOf(owner.address)
    const basketName = await rToken.name()
    await zapper.connect(owner).zapIn(purchaseToken, targetBasket, convertedSpend)
    const rTokenBalanceAfter = await rToken.balanceOf(owner.address)
    expect(rTokenBalanceAfter).to.be.gt(rTokenBalanceBefore)

    const rTokenDisplayBalance = formatBalance(rTokenBalanceAfter).toFixed(2)
    const displayBalance = formatBalance(convertedSpend, decimals).toFixed(2)
    await rToken.connect(owner).approve(zapper.address, ethers.constants.MaxUint256)
    await zapper.connect(owner).zapOut(targetBasket, purchaseToken, rTokenBalanceAfter)
    const balanceOfAfter = await token.balanceOf(owner.address)
    const displayBalanceAfter = formatBalance(balanceOfAfter, decimals).toFixed(2)
    const effeciency =
      (100 * formatBalance(balanceOfAfter, decimals)) / formatBalance(convertedSpend, decimals)
    expect(effeciency).to.be.lte(101)

    const result = {
      from: tokenName,
      tokenAmount: displayBalance,
      to: basketName,
      rTokenAmount: rTokenDisplayBalance,
      redeemAmount: displayBalanceAfter,
      efficiency: `${effeciency.toFixed(2)}%`,
    }

    await token.connect(owner).transfer(other.address, balanceOfAfter)

    return result
  }
})
