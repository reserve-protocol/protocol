import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Contract } from 'ethers'
import hre, { ethers } from 'hardhat'
import { Collateral, IMPLEMENTATION } from '../fixtures'
import { defaultFixtureNoBasket, DefaultFixture } from '../integration/fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, baseL2Chains, networkConfig } from '../../common/configuration'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import { pushOracleForward } from '../utils/oracles'

import forkBlockNumber from '../integration/fork-block-numbers'
import {
  ATokenFiatCollateral,
  AaveV3FiatCollateral,
  CTokenV3Collateral,
  CTokenFiatCollateral,
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
  StaticATokenV3LM,
  CusdcV3Wrapper,
  CometInterface,
  StargateRewardableWrapper,
  StargatePoolFiatCollateral,
  IStargatePool,
  MorphoAaveV2TokenisedDeposit,
} from '../../typechain'
import { useEnv } from '#/utils/env'
import { MAX_UINT256 } from '#/common/constants'

enum CollPluginType {
  AAVE_V2,
  AAVE_V3,
  COMPOUND_V2,
  COMPOUND_V3,
  STARGATE,
  FLUX,
  MORPHO_AAVE_V2,
}

// Relevant addresses (Mainnet)
const holderDAI = '0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8'
const holderCDAI = '0x01d127D90513CCB6071F83eFE15611C4d9890668'
const holderADAI = '0x07edE94cF6316F4809f2B725f5d79AD303fB4Dc8'
const holderaUSDCV3 = '0x1eAb3B222A5B57474E0c237E7E1C4312C1066855'
const holderWETH = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
const holdercUSDCV3 = '0x7f714b13249BeD8fdE2ef3FBDfB18Ed525544B03'
const holdersUSDC = '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b'
const holderfUSDC = '0x86A07dDED024121b282362f4e7A249b00F5dAB37'
const holderUSDC = '0x28C6c06298d514Db089934071355E5743bf21d60'

let owner: SignerWithAddress

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`FacadeMonitor - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
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
  let sUsdc: IStargatePool
  let fUsdc: TestICToken
  let weth: IWETH
  let cDai: TestICToken
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
  let basket: Collateral[]
  let erc20s: IERC20[]

  let fullLiquidityAmt: BigNumber
  let chainId: number

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

  describe('FacadeMonitor', () => {
    before(async () => {
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
      } = <DefaultFixture>await loadFixture(defaultFixtureNoBasket))

      // Get tokens
      dai = <ERC20Mock>erc20s[0] // DAI
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

      cusdcV3 = <CometInterface>(
        await ethers.getContractAt('CometInterface', networkConfig[chainId].tokens.cUSDCv3 || '')
      )

      cDai = <TestICToken>(
        await ethers.getContractAt('TestICToken', networkConfig[chainId].tokens.cDAI || '')
      )

      sUsdc = <IStargatePool>(
        await ethers.getContractAt('IStargatePool', networkConfig[chainId].tokens.sUSDC || '')
      )

      fUsdc = <TestICToken>(
        await ethers.getContractAt('TestICToken', networkConfig[chainId].tokens.fUSDC || '')
      )

      initialBal = bn('2500000e18')

      // Fund user with static aDAI
      await whileImpersonating(holderADAI, async (adaiSigner) => {
        // Wrap ADAI into static ADAI
        await aDai.connect(adaiSigner).transfer(addr1.address, initialBal)
        await aDai.connect(addr1).approve(stataDai.address, initialBal)
        await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, false)
      })

      // Fund user with aUSDCV3
      await whileImpersonating(holderaUSDCV3, async (ausdcV3Signer) => {
        await aUsdcV3.connect(ausdcV3Signer).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })

      // Fund user with DAI
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr1.address, initialBal.mul(8))
      })

      // Fund user with cDAI
      await whileImpersonating(holderCDAI, async (cdaiSigner) => {
        await cDai.connect(cdaiSigner).transfer(addr1.address, toBNDecimals(initialBal, 8).mul(100))
      })

      // Fund user with cUSDCV3
      await whileImpersonating(holdercUSDCV3, async (cusdcV3Signer) => {
        await cusdcV3.connect(cusdcV3Signer).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })

      // Fund user with sUSDC
      await whileImpersonating(holdersUSDC, async (susdcSigner) => {
        await sUsdc.connect(susdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })

      // Fund user with fUSDC
      await whileImpersonating(holderfUSDC, async (fusdcSigner) => {
        await fUsdc
          .connect(fusdcSigner)
          .transfer(addr1.address, toBNDecimals(initialBal, 8).mul(100))
      })

      // Fund user with USDC
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })

      // Fund user with WETH
      weth = <IWETH>await ethers.getContractAt('IWETH', networkConfig[chainId].tokens.WETH || '')
      await whileImpersonating(holderWETH, async (signer) => {
        await weth.connect(signer).transfer(addr1.address, fp('500000'))
      })
    })

    describe('AAVE V2', () => {
      const issueAmount: BigNumber = bn('1000000e18')
      let lendingPool: ILendingPool
      let aaveV2DataProvider: Contract

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

        lendingPool = <ILendingPool>(
          await ethers.getContractAt('ILendingPool', networkConfig[chainId].AAVE_LENDING_POOL || '')
        )

        const aaveV2DataProviderAbi = [
          'function getReserveData(address asset) external view returns (uint256 availableLiquidity,uint256 totalStableDebt,uint256 totalVariableDebt,uint256 liquidityRate,uint256 variableBorrowRate,uint256 stableBorrowRate,uint256 averageStableBorrowRate,uint256 liquidityIndex,uint256 variableBorrowIndex,uint40 lastUpdateTimestamp)',
        ]
        aaveV2DataProvider = await ethers.getContractAt(
          aaveV2DataProviderAbi,
          networkConfig[chainId].AAVE_DATA_PROVIDER || ''
        )

        // Get current liquidity
        ;[fullLiquidityAmt, , , , , , , , ,] = await aaveV2DataProvider
          .connect(addr1)
          .getReserveData(dai.address)

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

    describe('AAVE V3', () => {
      const issueAmount: BigNumber = bn('1000000e18')
      let stataUsdcV3: StaticATokenV3LM
      let pool: IPool

      beforeEach(async () => {
        const StaticATokenFactory = await hre.ethers.getContractFactory('StaticATokenV3LM')
        stataUsdcV3 = await StaticATokenFactory.deploy(
          networkConfig[chainId].AAVE_V3_POOL!,
          networkConfig[chainId].AAVE_V3_INCENTIVES_CONTROLLER!
        )

        await stataUsdcV3.deployed()
        await (
          await stataUsdcV3.initialize(
            networkConfig[chainId].tokens.aEthUSDC!,
            'Static Aave Ethereum USDC',
            'saEthUSDC'
          )
        ).wait()

        /********  Deploy Aave V3 USDC collateral plugin  **************************/
        const usdcOracleTimeout = '86400' // 24 hr
        const usdcOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

        const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

        const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')
        const collateral = <AaveV3FiatCollateral>await CollateralFactory.connect(owner).deploy(
          {
            priceTimeout: bn('604800'),
            chainlinkFeed: chainlinkFeed.address,
            oracleError: usdcOracleError,
            erc20: stataUsdcV3.address,
            maxTradeVolume: fp('1e6'),
            oracleTimeout: usdcOracleTimeout,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold: fp('0.01').add(usdcOracleError),
            delayUntilDefault: bn('86400'),
          },
          fp('1e-6')
        )

        // Register and update collateral
        await collateral.deployed()
        await (await collateral.refresh()).wait()
        await pushOracleForward(chainlinkFeed.address)
        await assetRegistry.connect(owner).register(collateral.address)

        // Wrap aUsdcV3
        await aUsdcV3.connect(addr1).approve(stataUsdcV3.address, toBNDecimals(initialBal, 6))
        await stataUsdcV3
          .connect(addr1)
          ['deposit(uint256,address,uint16,bool)'](
            toBNDecimals(initialBal, 6),
            addr1.address,
            0,
            false
          )

        // Get current liquidity
        fullLiquidityAmt = await usdc.balanceOf(aUsdcV3.address)

        // Setup basket
        await pushOracleForward(chainlinkFeed.address)
        await basketHandler.connect(owner).setPrimeBasket([stataUsdcV3.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await stataUsdcV3.connect(addr1).approve(rToken.address, issueAmount)

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)
        await pushOracleForward(chainlinkFeed.address)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        pool = <IPool>await ethers.getContractAt('IPool', networkConfig[chainId].AAVE_V3_POOL || '')

        // Provide liquidity to be able to borrow
        const amountToDeposit = fp('500000')
        await weth.connect(addr1).approve(pool.address, amountToDeposit)
        await pool.connect(addr1).supply(weth.address, amountToDeposit, addr1.address, 0)
      })

      it('Should return 100% when full liquidity available', async function () {
        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        )

        // AAVE V3 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V3,
            stataUsdcV3.address
          )
        ).to.equal(fp('1'))

        // Confirm all can be redeemed
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await stataUsdcV3.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await stataUsdcV3.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await stataUsdcV3
          .connect(addr2)
          ['redeem(uint256,address,address,bool)'](
            bmBalanceAmt,
            addr2.address,
            addr2.address,
            false
          )
        await expect(pool.connect(addr2).withdraw(usdc.address, MAX_UINT256, addr2.address)).to.not
          .be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(bn(0))
        expect(await aUsdcV3.balanceOf(addr2.address)).to.equal(bn(0))
      })

      it('Should return backing redeemable percent correctly', async function () {
        // AAVE V3 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V3,
            stataUsdcV3.address
          )
        ).to.equal(fp('1'))

        // Leave only 80% of backing to be able to be redeemed
        const borrowAmount = fullLiquidityAmt.sub(toBNDecimals(issueAmount, 6).mul(80).div(100))
        await pool.connect(addr1).borrow(usdc.address, borrowAmount, 2, 0, addr1.address)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V3,
            stataUsdcV3.address
          )
        ).to.be.closeTo(fp('0.80'), fp('0.01'))

        // Borrow half of the remaining liquidity
        const remainingLiquidity = fullLiquidityAmt.sub(borrowAmount)
        await pool
          .connect(addr1)
          .borrow(usdc.address, remainingLiquidity.div(2), 2, 0, addr1.address)

        // Only 40% available to be redeemed
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V3,
            stataUsdcV3.address
          )
        ).to.be.closeTo(fp('0.40'), fp('0.01'))

        // Confirm we cannot redeem full balance
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await stataUsdcV3.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await stataUsdcV3.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await stataUsdcV3
          .connect(addr2)
          ['redeem(uint256,address,address,bool)'](
            bmBalanceAmt,
            addr2.address,
            addr2.address,
            false
          )
        await expect(pool.connect(addr2).withdraw(usdc.address, MAX_UINT256, addr2.address)).to.be
          .reverted
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))

        // We can redeem if we reduce to 30%
        await expect(
          pool
            .connect(addr2)
            .withdraw(
              usdc.address,
              (await aUsdcV3.balanceOf(addr2.address)).mul(30).div(100),
              addr2.address
            )
        ).to.not.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(0)
      })

      it('Should handle no liquidity', async function () {
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V3,
            stataUsdcV3.address
          )
        ).to.equal(fp('1'))

        // Borrow full liquidity
        await pool.connect(addr1).borrow(usdc.address, fullLiquidityAmt, 2, 0, addr1.address)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.AAVE_V3,
            stataUsdcV3.address
          )
        ).to.be.closeTo(fp('0'), fp('0.01'))

        // Confirm we cannot redeem anything, not even 1%
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await stataUsdcV3.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await stataUsdcV3.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await stataUsdcV3
          .connect(addr2)
          ['redeem(uint256,address,address,bool)'](
            bmBalanceAmt,
            addr2.address,
            addr2.address,
            false
          )
        await expect(
          pool
            .connect(addr2)
            .withdraw(
              usdc.address,
              (await aUsdcV3.balanceOf(addr2.address)).div(100),
              addr2.address
            )
        ).to.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
      })
    })

    describe('Compound V2', () => {
      const issueAmount: BigNumber = bn('1000000e18')
      let comptroller: IComptroller

      beforeEach(async () => {
        // Setup basket
        await basketHandler.connect(owner).setPrimeBasket([cDai.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await cDai.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Get current liquidity
        fullLiquidityAmt = await dai.balanceOf(cDai.address)

        // Compound Comptroller
        comptroller = await ethers.getContractAt(
          'ComptrollerMock',
          networkConfig[chainId].COMPTROLLER || ''
        )

        // Deposit ETH to be able to borrow
        const cEtherAbi = [
          'function mint(uint256 mintAmount) external payable returns (uint256)',
          'function balanceOf(address owner) external view returns (uint256 balance)',
        ]
        const cEth = await ethers.getContractAt(cEtherAbi, networkConfig[chainId].tokens.cETH || '')
        await comptroller.connect(addr1).enterMarkets([cEth.address])
        const amountToDeposit = fp('500000')
        await weth.connect(addr1).withdraw(amountToDeposit)
        await cEth.connect(addr1).mint(amountToDeposit, { value: amountToDeposit })
      })

      it('Should return 100% when full liquidity available', async function () {
        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        )

        // COMPOUND V2 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V2,
            cDai.address
          )
        ).to.equal(fp('1'))

        // Confirm all can be redeemed
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await cDai.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await cDai.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        expect(await cDai.balanceOf(addr2.address)).to.equal(bmBalanceAmt)

        await expect(cDai.connect(addr2).redeem(bmBalanceAmt)).to.not.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.be.gt(bn(0))
        expect(await cDai.balanceOf(addr2.address)).to.equal(bn(0))
      })

      it('Should return backing redeemable percent correctly', async function () {
        // COMPOUND V2 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V2,
            cDai.address
          )
        ).to.equal(fp('1'))

        // Leave only 80% of backing to be able to be redeemed
        const borrowAmount = fullLiquidityAmt.sub(issueAmount.mul(80).div(100))
        await cDai.connect(addr1).borrow(borrowAmount)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V2,
            cDai.address
          )
        ).to.be.closeTo(fp('0.80'), fp('0.01'))

        // Borrow half of the remaining liquidity
        const remainingLiquidity = fullLiquidityAmt.sub(borrowAmount)
        await cDai.connect(addr1).borrow(bn(remainingLiquidity.div(2)))

        // Now only 40% of backing can be redeemed
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V2,
            cDai.address
          )
        ).to.be.closeTo(fp('0.40'), fp('0.01'))

        // Confirm we cannot redeem full balance
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await cDai.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await cDai.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await expect(cDai.connect(addr2).redeem(bmBalanceAmt)).to.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))

        //  We can redeem iff we reduce to 30%
        await expect(cDai.connect(addr2).redeem(bmBalanceAmt.mul(30).div(100))).to.not.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.be.gt(0)
      })

      it('Should handle no liquidity', async function () {
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V2,
            cDai.address
          )
        ).to.equal(fp('1'))

        // Borrow full liquidity
        await cDai.connect(addr1).borrow(fullLiquidityAmt)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V2,
            cDai.address
          )
        ).to.be.closeTo(fp('0'), fp('0.01'))

        // Confirm we cannot redeem anything, not even 1%
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await cDai.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await cDai.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        expect(await cDai.balanceOf(addr2.address)).to.equal(bmBalanceAmt)

        await expect(cDai.connect(addr2).redeem((await cDai.balanceOf(addr2.address)).div(100))).to
          .be.reverted
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
      })
    })

    describe('Compound V3', () => {
      const issueAmount: BigNumber = bn('1000000e18')
      let wcusdcV3: CusdcV3Wrapper

      beforeEach(async () => {
        const CUsdcV3WrapperFactory = await hre.ethers.getContractFactory('CusdcV3Wrapper')

        wcusdcV3 = <CusdcV3Wrapper>(
          await CUsdcV3WrapperFactory.deploy(
            cusdcV3.address,
            networkConfig[chainId].COMET_REWARDS || '',
            networkConfig[chainId].tokens.COMP || ''
          )
        )
        await wcusdcV3.deployed()

        /********  Deploy Compound V3 USDC collateral plugin  **************************/
        const CollateralFactory = await ethers.getContractFactory('CTokenV3Collateral')

        const usdcOracleTimeout = '86400' // 24 hr
        const usdcOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

        const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

        const collateral = <CTokenV3Collateral>await CollateralFactory.connect(owner).deploy(
          {
            priceTimeout: bn('604800'),
            chainlinkFeed: chainlinkFeed.address,
            oracleError: usdcOracleError.toString(),
            erc20: wcusdcV3.address,
            maxTradeVolume: fp('1e6').toString(), // $1m,
            oracleTimeout: usdcOracleTimeout, // 24h hr,
            targetName: hre.ethers.utils.formatBytes32String('USD'),
            defaultThreshold: fp('0.01').add(usdcOracleError).toString(),
            delayUntilDefault: bn('86400').toString(), // 24h
          },
          fp('1e-6')
        )

        // Register and update collateral
        await collateral.deployed()
        await (await collateral.refresh()).wait()
        await pushOracleForward(chainlinkFeed.address)
        await assetRegistry.connect(owner).register(collateral.address)

        // Wrap cUSDCV3
        await cusdcV3.connect(addr1).allow(wcusdcV3.address, true)
        await wcusdcV3.connect(addr1).deposit(toBNDecimals(initialBal, 6))

        // Get current liquidity
        fullLiquidityAmt = await usdc.balanceOf(cusdcV3.address)

        // Setup basket
        await pushOracleForward(chainlinkFeed.address)
        await basketHandler.connect(owner).setPrimeBasket([wcusdcV3.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await wcusdcV3.connect(addr1).approve(rToken.address, MAX_UINT256)

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)
        await pushOracleForward(chainlinkFeed.address)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Provide liquidity to be able to borrow
        const amountToDeposit = fp('500000')
        await weth.connect(addr1).approve(cusdcV3.address, amountToDeposit)
        await cusdcV3.connect(addr1).supply(weth.address, amountToDeposit.div(2))
      })

      it('Should return 100% when full liquidity available', async function () {
        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        )

        // Compound V3 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V3,
            wcusdcV3.address
          )
        ).to.equal(fp('1'))

        // Confirm all can be redeemed
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await wcusdcV3.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await wcusdcV3.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await wcusdcV3.connect(addr2).withdraw(MAX_UINT256)

        await expect(cusdcV3.connect(addr2).withdraw(usdc.address, MAX_UINT256)).to.not.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(bn(0))
        expect(await cusdcV3.balanceOf(addr2.address)).to.equal(bn(0))
      })

      it('Should return backing redeemable percent correctly', async function () {
        // AAVE V3 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V3,
            wcusdcV3.address
          )
        ).to.equal(fp('1'))

        // Leave only 80% of backing to be able to be redeemed
        const borrowAmount = fullLiquidityAmt.sub(toBNDecimals(issueAmount, 6).mul(80).div(100))
        await cusdcV3.connect(addr1).withdraw(usdc.address, borrowAmount)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V3,
            wcusdcV3.address
          )
        ).to.be.closeTo(fp('0.80'), fp('0.01'))

        // Borrow half of the remaining liquidity
        const remainingLiquidity = fullLiquidityAmt.sub(borrowAmount)
        await cusdcV3.connect(addr1).withdraw(usdc.address, remainingLiquidity.div(2))

        // Only 40% available to be redeemed
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V3,
            wcusdcV3.address
          )
        ).to.be.closeTo(fp('0.40'), fp('0.01'))

        // Confirm we cannot redeem full balance
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await wcusdcV3.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await wcusdcV3.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await wcusdcV3.connect(addr2).withdraw(MAX_UINT256)

        await expect(cusdcV3.connect(addr2).withdraw(usdc.address, MAX_UINT256)).to.be.reverted
        expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))

        // We can redeem if we reduce to 30%
        await expect(
          cusdcV3
            .connect(addr2)
            .withdraw(usdc.address, (await cusdcV3.balanceOf(addr2.address)).mul(30).div(100))
        ).to.not.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(0)
      })

      it('Should handle no liquidity', async function () {
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V3,
            wcusdcV3.address
          )
        ).to.equal(fp('1'))

        // Borrow full liquidity
        await cusdcV3.connect(addr1).withdraw(usdc.address, fullLiquidityAmt)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.COMPOUND_V3,
            wcusdcV3.address
          )
        ).to.be.closeTo(fp('0'), fp('0.01'))

        // Confirm we cannot redeem anything, not even 1%
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await wcusdcV3.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await wcusdcV3.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await wcusdcV3.connect(addr2).withdraw(MAX_UINT256)

        await expect(
          cusdcV3
            .connect(addr2)
            .withdraw(usdc.address, (await cusdcV3.balanceOf(addr2.address)).div(100))
        ).to.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
      })
    })

    describe('Stargate', () => {
      const issueAmount: BigNumber = bn('1000000e18')
      let wstgUsdc: StargateRewardableWrapper

      beforeEach(async () => {
        const SthWrapperFactory = await hre.ethers.getContractFactory('StargateRewardableWrapper')

        wstgUsdc = await SthWrapperFactory.deploy(
          'Wrapped Stargate USDC',
          'wsgUSDC',
          networkConfig[chainId].tokens.STG!,
          networkConfig[chainId].STARGATE_STAKING_CONTRACT!,
          networkConfig[chainId].tokens.sUSDC!
        )
        await wstgUsdc.deployed()

        /********  Deploy Stargate USDC collateral plugin  **************************/
        const usdcOracleTimeout = '86400' // 24 hr
        const usdcOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

        const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

        const CollateralFactory = await hre.ethers.getContractFactory('StargatePoolFiatCollateral')
        const collateral = <StargatePoolFiatCollateral>await CollateralFactory.connect(
          owner
        ).deploy(
          {
            priceTimeout: bn('604800'),
            chainlinkFeed: chainlinkFeed.address,
            oracleError: usdcOracleError,
            erc20: wstgUsdc.address,
            maxTradeVolume: fp('1e6'),
            oracleTimeout: usdcOracleTimeout,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold: fp('0.01').add(usdcOracleError),
            delayUntilDefault: bn('86400'),
          },
          fp('1e-6')
        )

        // Register and update collateral
        await collateral.deployed()
        await (await collateral.refresh()).wait()
        await pushOracleForward(chainlinkFeed.address)
        await assetRegistry.connect(owner).register(collateral.address)

        // Wrap sUsdc
        await sUsdc.connect(addr1).approve(wstgUsdc.address, toBNDecimals(initialBal, 6))
        await wstgUsdc.connect(addr1).deposit(toBNDecimals(initialBal, 6), addr1.address)

        // Get current liquidity
        fullLiquidityAmt = await sUsdc.totalLiquidity()

        // Setup basket
        await pushOracleForward(chainlinkFeed.address)
        await basketHandler.connect(owner).setPrimeBasket([wstgUsdc.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await wstgUsdc.connect(addr1).approve(rToken.address, issueAmount)

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)
        await pushOracleForward(chainlinkFeed.address)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should return 100%, full liquidity available at all times', async function () {
        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        )

        // AAVE V3 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.STARGATE,
            wstgUsdc.address
          )
        ).to.equal(fp('1'))
      })
    })

    describe('Flux', () => {
      const issueAmount: BigNumber = bn('1000000e18')

      beforeEach(async () => {
        /********  Deploy Flux USDC collateral plugin  **************************/
        const CollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')

        const usdcOracleTimeout = '86400' // 24 hr
        const usdcOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

        const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

        const collateral = <CTokenFiatCollateral>await CollateralFactory.connect(owner).deploy(
          {
            priceTimeout: bn('604800'),
            chainlinkFeed: chainlinkFeed.address,
            oracleError: usdcOracleError.toString(),
            erc20: fUsdc.address,
            maxTradeVolume: fp('1e6').toString(), // $1m,
            oracleTimeout: usdcOracleTimeout, // 24h hr,
            targetName: hre.ethers.utils.formatBytes32String('USD'),
            defaultThreshold: fp('0.01').add(usdcOracleError).toString(),
            delayUntilDefault: bn('86400').toString(), // 24h
          },
          fp('1e-6')
        )

        // Register and update collateral
        await collateral.deployed()
        await (await collateral.refresh()).wait()
        await pushOracleForward(chainlinkFeed.address)
        await assetRegistry.connect(owner).register(collateral.address)

        // Get current liquidity
        fullLiquidityAmt = await usdc.balanceOf(fUsdc.address)

        // Setup basket
        await pushOracleForward(chainlinkFeed.address)
        await basketHandler.connect(owner).setPrimeBasket([fUsdc.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await fUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)
        await pushOracleForward(chainlinkFeed.address)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should return 100% when full liquidity available', async function () {
        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        )

        // FLUX - All redeemable
        expect(
          await facadeMonitor.backingReedemable(rToken.address, CollPluginType.FLUX, fUsdc.address)
        ).to.equal(fp('1'))

        // Confirm all can be redeemed
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await fUsdc.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await fUsdc.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        await expect(fUsdc.connect(addr2).redeem(bmBalanceAmt)).to.not.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(bn(0))
        expect(await fUsdc.balanceOf(addr2.address)).to.equal(bn(0))
      })
    })

    describe('MORPHO - AAVE V2', () => {
      const issueAmount: BigNumber = bn('1000000e18')
      let lendingPool: ILendingPool
      let maUSDC: MorphoAaveV2TokenisedDeposit
      let aaveV2DataProvider: Contract

      beforeEach(async () => {
        /********  Deploy Morpho AAVE V2 USDC collateral plugin  **************************/
        const MorphoTokenisedDepositFactory = await ethers.getContractFactory(
          'MorphoAaveV2TokenisedDeposit'
        )
        maUSDC = await MorphoTokenisedDepositFactory.deploy({
          morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
          morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
          underlyingERC20: networkConfig[chainId].tokens.USDC!,
          poolToken: networkConfig[chainId].tokens.aUSDC!,
          rewardToken: networkConfig[chainId].tokens.MORPHO!,
        })

        const CollateralFactory = await hre.ethers.getContractFactory('MorphoFiatCollateral')

        const usdcOracleTimeout = '86400' // 24 hr
        const usdcOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%
        const baseStableConfig = {
          priceTimeout: bn('604800').toString(),
          oracleError: usdcOracleError.toString(),
          maxTradeVolume: fp('1e6').toString(), // $1m,
          oracleTimeout: usdcOracleTimeout, // 24h
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: usdcOracleError.add(fp('0.01')), // 1.25%
          delayUntilDefault: bn('86400').toString(), // 24h
        }
        const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

        const collateral = await CollateralFactory.connect(owner).deploy(
          {
            ...baseStableConfig,
            chainlinkFeed: chainlinkFeed.address,
            erc20: maUSDC.address,
          },
          fp('1e-6')
        )

        // Register and update collateral
        await collateral.deployed()
        await (await collateral.refresh()).wait()
        await pushOracleForward(chainlinkFeed.address)
        await assetRegistry.connect(owner).register(collateral.address)

        const aaveV2DataProviderAbi = [
          'function getReserveData(address asset) external view returns (uint256 availableLiquidity,uint256 totalStableDebt,uint256 totalVariableDebt,uint256 liquidityRate,uint256 variableBorrowRate,uint256 stableBorrowRate,uint256 averageStableBorrowRate,uint256 liquidityIndex,uint256 variableBorrowIndex,uint40 lastUpdateTimestamp)',
        ]
        aaveV2DataProvider = await ethers.getContractAt(
          aaveV2DataProviderAbi,
          networkConfig[chainId].AAVE_DATA_PROVIDER || ''
        )

        await facadeMonitor.backingReedemable(
          rToken.address,
          CollPluginType.MORPHO_AAVE_V2,
          maUSDC.address
        )

        // Wrap maUSDC
        await usdc.connect(addr1).approve(maUSDC.address, 0)
        await usdc.connect(addr1).approve(maUSDC.address, MAX_UINT256)
        await maUSDC.connect(addr1).mint(toBNDecimals(initialBal, 15), addr1.address)

        // Setup basket
        await pushOracleForward(chainlinkFeed.address)
        await basketHandler.connect(owner).setPrimeBasket([maUSDC.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Provide approvals
        await maUSDC.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 15))

        // Advance time significantly - Recharge throttle
        await advanceTime(100000)
        await pushOracleForward(chainlinkFeed.address)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

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

        // MORPHO AAVE V2 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.MORPHO_AAVE_V2,
            maUSDC.address
          )
        ).to.equal(fp('1'))

        // Confirm all can be redeemed
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await maUSDC.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await maUSDC.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        const maxWithdraw = await maUSDC.maxWithdraw(addr2.address)
        await expect(maUSDC.connect(addr2).withdraw(maxWithdraw, addr2.address, addr2.address)).to
          .not.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(bn(0))
      })

      it('Should return backing redeemable percent correctly', async function () {
        // MORPHO AAVE V2 - All redeemable
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.MORPHO_AAVE_V2,
            maUSDC.address
          )
        ).to.equal(fp('1'))

        // Get current liquidity from Aave V2 (Morpho relies on this)
        ;[fullLiquidityAmt, , , , , , , , ,] = await aaveV2DataProvider
          .connect(addr1)
          .getReserveData(usdc.address)

        // Leave only 80% of backing available to be redeemed
        const borrowAmount = fullLiquidityAmt.sub(toBNDecimals(issueAmount, 6).mul(80).div(100))
        await lendingPool.connect(addr1).borrow(usdc.address, borrowAmount, 2, 0, addr1.address)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.MORPHO_AAVE_V2,
            maUSDC.address
          )
        ).to.be.closeTo(fp('0.80'), fp('0.01'))

        // Borrow half of the remaining liquidity
        const remainingLiquidity = fullLiquidityAmt.sub(borrowAmount)
        await lendingPool
          .connect(addr1)
          .borrow(usdc.address, remainingLiquidity.div(2), 2, 0, addr1.address)

        // Now only 40% is available to be redeemed
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.MORPHO_AAVE_V2,
            maUSDC.address
          )
        ).to.be.closeTo(fp('0.40'), fp('0.01'))

        // Confirm we cannot redeem full balance
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await maUSDC.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await maUSDC.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        const maxWithdraw = await maUSDC.maxWithdraw(addr2.address)
        await expect(maUSDC.connect(addr2).withdraw(maxWithdraw, addr2.address, addr2.address)).to
          .be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))

        // But we can redeem if we reduce the amount to 30%
        await expect(
          maUSDC.connect(addr2).withdraw(maxWithdraw.mul(30).div(100), addr2.address, addr2.address)
        ).to.not.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.be.gt(0)
      })

      it('Should handle no liquidity', async function () {
        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.MORPHO_AAVE_V2,
            maUSDC.address
          )
        ).to.equal(fp('1'))

        // Get current liquidity from Aave V2 (Morpho relies on this)
        ;[fullLiquidityAmt, , , , , , , , ,] = await aaveV2DataProvider
          .connect(addr1)
          .getReserveData(usdc.address)

        // Borrow full liquidity
        await lendingPool.connect(addr1).borrow(usdc.address, fullLiquidityAmt, 2, 0, addr1.address)

        expect(
          await facadeMonitor.backingReedemable(
            rToken.address,
            CollPluginType.MORPHO_AAVE_V2,
            maUSDC.address
          )
        ).to.be.closeTo(fp('0'), fp('0.01'))

        // Confirm we cannot redeem anything, not even 1%
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
        const bmBalanceAmt = await maUSDC.balanceOf(backingManager.address)
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await maUSDC.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
        })
        const maxWithdraw = await maUSDC.maxWithdraw(addr2.address)
        await expect(
          maUSDC.connect(addr2).withdraw(maxWithdraw.div(100), addr2.address, addr2.address)
        ).to.be.reverted
        expect(await usdc.balanceOf(addr2.address)).to.equal(bn(0))
      })
    })
  })
})
