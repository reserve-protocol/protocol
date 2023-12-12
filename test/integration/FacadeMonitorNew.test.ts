import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { Collateral, IMPLEMENTATION } from '../fixtures'
import { defaultFixtureNoBasket } from './fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, baseL2Chains, networkConfig } from '../../common/configuration'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import { pushOracleForward } from '../utils/oracles'

import forkBlockNumber from './fork-block-numbers'
import {
  ATokenFiatCollateral,
  AaveV3FiatCollateral,
  CTokenV3Collateral,
  ERC20Mock,
  FacadeTest,
  FacadeMonitor,
  FiatCollateral,
  IAToken,
  IComptroller,
  IERC20,
  ILendingPool,
  IPool,
  IWETH,
  StaticATokenLM,
  IAssetRegistry,
  TestIBackingManager,
  TestIBasketHandler,
  TestICToken,
  TestIRToken,
  USDCMock,
  CTokenWrapper,
  StaticATokenV3LM,
  CusdcV3Wrapper,
  CometInterface,
} from '../../typechain'
import { useEnv } from '#/utils/env'
import { MAX_UINT256 } from '#/common/constants'

type Fixture<T> = () => Promise<T>

// interface RewardableERC20Fixture {
//   rewardableVault: RewardableERC4626VaultTest | RewardableERC20WrapperTest
//   rewardableAsset: ERC20MockRewarding
//   rewardToken: ERC20MockDecimals
//   rewardableVaultFactory: ContractFactory
// }

// Relevant addresses (Mainnet)
const holderCDAI = '0x01d127D90513CCB6071F83eFE15611C4d9890668'
const holderADAI = '0x07edE94cF6316F4809f2B725f5d79AD303fB4Dc8'
const holderaUSDCV3 = '0x1eAb3B222A5B57474E0c237E7E1C4312C1066855'
const holderWETH = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
const holdercUSDCV3 = '0x7f714b13249BeD8fdE2ef3FBDfB18Ed525544B03'

enum CollPluginType {
  AAVE_V2,
  AAVE_V3,
  COMPOUND_V2,
  COMPOUND_V3,
}

let owner: SignerWithAddress

const describeFork = useEnv('FORK') ? describe : describe.skip

const collPluginTypes: CollPluginType[] = [
  CollPluginType.AAVE_V2,
  CollPluginType.AAVE_V3,
  CollPluginType.COMPOUND_V2,
  CollPluginType.COMPOUND_V3,
]

//describeFork(`FacadeMonitor - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
let addr1: SignerWithAddress
let addr2: SignerWithAddress

// Assets
let collateral: Collateral[]

// Tokens and Assets
let dai: ERC20Mock
let aDai: IAToken
let stataDai: StaticATokenLM
let usdc: USDCMock
let aUsdcV3: IAToken
let weth: IWETH
let cDai: TestICToken
let cDaiVault: CTokenWrapper
let cusdcV3: CometInterface
let daiCollateral: FiatCollateral
let aDaiCollateral: ATokenFiatCollateral

// Contracts to retrieve after deploy
let rToken: TestIRToken
let facadeTest: FacadeTest
let facadeMonitor: FacadeMonitor
let assetRegistry: IAssetRegistry
let basketHandler: TestIBasketHandler
let backingManager: TestIBackingManager
let config: IConfig

let initialBal: BigNumber
let issueAmount: BigNumber
let basket: Collateral[]
let erc20s: IERC20[]

let fullLiquidityAmt: BigNumber
let chainId: number

// AAVE V2
let lendingPool: ILendingPool

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

describeFork(`FacadeMonitor`, () => {
  before(async () => {
    console.log('RESET NETWORK')
    await setup(forkBlockNumber['facade-monitor'])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    ;({
      erc20s,
      collateral,
      basket,
      assetRegistry,
      basketHandler,
      backingManager,
      rToken,
      facadeTest,
      facadeMonitor,
      config,
    } = await loadFixture(defaultFixtureNoBasket))

    // Fund user with WETH
    weth = <IWETH>await ethers.getContractAt('IWETH', networkConfig[chainId].tokens.WETH || '')

    // Get tokens
    dai = <ERC20Mock>erc20s[0] // DAI
    cDaiVault = <CTokenWrapper>erc20s[6] // cDAI
    cDai = <TestICToken>await ethers.getContractAt('TestICToken', await cDaiVault.underlying()) // cDAI
    stataDai = <StaticATokenLM>erc20s[10] // static aDAI

    // Get plain aTokens
    aDai = <IAToken>(
      await ethers.getContractAt(
        '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
        networkConfig[chainId].tokens.aDAI || ''
      )
    )

    // Get collaterals
    daiCollateral = <FiatCollateral>collateral[0] // DAI
    aDaiCollateral = <ATokenFiatCollateral>collateral[10] // aDAI

    // Get assets and tokens for default basket
    daiCollateral = <FiatCollateral>basket[0]
    aDaiCollateral = <ATokenFiatCollateral>basket[1]

    dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await daiCollateral.erc20())
    stataDai = <StaticATokenLM>(
      await ethers.getContractAt('StaticATokenLM', await aDaiCollateral.erc20())
    )

    // Get plain aToken
    aDai = <IAToken>(
      await ethers.getContractAt(
        '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
        networkConfig[chainId].tokens.aDAI || ''
      )
    )

    usdc = <USDCMock>(
      await ethers.getContractAt('USDCMock', networkConfig[chainId].tokens.USDC || '')
    )
    aUsdcV3 = <IAToken>await ethers.getContractAt(
      '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken', // use V2 interface, it includes ERC20
      networkConfig[chainId].tokens.aEthUSDC || ''
    )

    await whileImpersonating(holderWETH, async (signer) => {
      await weth.connect(signer).transfer(addr1.address, fp('500000'))
    })

    // NEW SECTION
    initialBal = bn('2000000e18')
    issueAmount = bn('1000000e18')

    // aDAI
    await whileImpersonating(holderADAI, async (adaiSigner) => {
      // Wrap ADAI into static ADAI
      await aDai.connect(adaiSigner).transfer(addr1.address, initialBal)
      await aDai.connect(addr1).approve(stataDai.address, initialBal)
      await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, false)
    })
  })

  for (const pluginType of collPluginTypes) {
    describe(`FacadeMonitor-${pluginType}`, () => {
      beforeEach(async () => {
        // Setup basket
        await basketHandler.connect(owner).setPrimeBasket([stataDai.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await stataDai.connect(addr1).approve(rToken.address, issueAmount)

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Get current liquidity
        fullLiquidityAmt = await dai.balanceOf(aDai.address)

        lendingPool = <ILendingPool>(
          await ethers.getContractAt('ILendingPool', networkConfig[chainId].AAVE_LENDING_POOL || '')
        )

        // Provide liquidity in AAVE V2 to be able to borrow
        const amountToDeposit = fp('500000')
        await weth.connect(addr1).approve(lendingPool.address, amountToDeposit)
        await lendingPool.connect(addr1).deposit(weth.address, amountToDeposit, addr1.address, 0)
      })

      it('Should return 100% when full liquidity available', async function () {
        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        )

        // AAVE V2 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V2,
            stataDai.address
          )
        ).to.equal(fp('1'))

        // Confirm all can be redeemed
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await stataDai.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await stataDai.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await stataDai.connect(addr2).withdraw(addr2.address, bmBalanceAmt, false)
        await expect(lendingPool.connect(addr2).withdraw(dai.address, MAX_UINT256, addr2.address))
          .to.not.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.be.gt(bn(0))
        expect(await aDai.balanceOf(addr2.address)).to.equal(bn(0))
      })

      it('Should return backing redeemable percent correctly', async function () {
        // AAVE V2 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V2,
            stataDai.address
          )
        ).to.equal(fp('1'))

        // Leave only 80% of backing available to be redeemed
        const borrowAmount = fullLiquidityAmt.sub(issueAmount.mul(80).div(100))
        await lendingPool.connect(addr1).borrow(dai.address, borrowAmount, 2, 0, addr1.address)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V2,
            stataDai.address
          )
        ).to.be.closeTo(fp('0.80'), fp('0.01'))

        // Borrow half of the remaining liquidity
        const remainingLiquidity = fullLiquidityAmt.sub(borrowAmount)
        await lendingPool
          .connect(addr1)
          .borrow(dai.address, remainingLiquidity.div(2), 2, 0, addr1.address)

        // Now only 40% is available to be redeemed
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V2,
            stataDai.address
          )
        ).to.be.closeTo(fp('0.40'), fp('0.01'))

        // Confirm we cannot redeem full balance
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await stataDai.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await stataDai.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await stataDai.connect(addr2).withdraw(addr2.address, bmBalanceAmt, false)
        await expect(lendingPool.connect(addr2).withdraw(dai.address, MAX_UINT256, addr2.address))
          .to.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))

        // But we can redeem if we reduce the amount to 30%
        await expect(
          lendingPool
            .connect(addr2)
            .withdraw(
              dai.address,
              (await aDai.balanceOf(addr2.address)).mul(30).div(100),
              addr2.address
            )
        ).to.not.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.be.gt(0)
      })

      it('Should handle no liquidity', async function () {
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V2,
            stataDai.address
          )
        ).to.equal(fp('1'))

        // Borrow full liquidity
        await lendingPool.connect(addr1).borrow(dai.address, fullLiquidityAmt, 2, 0, addr1.address)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V2,
            stataDai.address
          )
        ).to.be.closeTo(fp('0'), fp('0.01'))

        // Confirm we cannot redeem anything, not even 1%
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await stataDai.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await stataDai.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await stataDai.connect(addr2).withdraw(addr2.address, bmBalanceAmt, false)
        await expect(
          lendingPool
            .connect(addr2)
            .withdraw(dai.address, (await aDai.balanceOf(addr2.address)).div(100), addr2.address)
        ).to.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
      })
    })
  }
})
