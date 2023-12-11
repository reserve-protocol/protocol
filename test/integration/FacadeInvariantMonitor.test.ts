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
  ERC20Mock,
  FacadeTest,
  FacadeInvariantMonitor,
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
} from '../../typechain'
import { useEnv } from '#/utils/env'
import { MAX_UINT256 } from '#/common/constants'

enum CollPluginType {
  AAVE_V2,
  AAVE_V3,
  COMPOUND_V2,
}

// Relevant addresses (Mainnet)
const holderCDAI = '0x01d127D90513CCB6071F83eFE15611C4d9890668'
const holderADAI = '0x07edE94cF6316F4809f2B725f5d79AD303fB4Dc8'
const holderaUSDCV3 = '0x1eAb3B222A5B57474E0c237E7E1C4312C1066855'
const holderWETH = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'

let owner: SignerWithAddress

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(
  `FacadeInvariantMonitor - Integration - Mainnet Forking P${IMPLEMENTATION}`,
  function () {
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

    let daiCollateral: FiatCollateral
    let aDaiCollateral: ATokenFiatCollateral

    // Contracts to retrieve after deploy
    let rToken: TestIRToken
    let facadeTest: FacadeTest
    let facadeInvariantMonitor: FacadeInvariantMonitor
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

    describe('FacadeInvariantMonitor', () => {
      before(async () => {
        await setup(forkBlockNumber['facade-invariant-monitor'])

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
          facadeInvariantMonitor,
          config,
        } = await loadFixture(defaultFixtureNoBasket))

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

        // Fund user with WETH
        weth = <IWETH>await ethers.getContractAt('IWETH', networkConfig[chainId].tokens.WETH || '')

        await whileImpersonating(holderWETH, async (signer) => {
          await weth.connect(signer).transfer(addr1.address, fp('500000'))
        })
      })

      describe('AAVE V2', () => {
        const issueAmount: BigNumber = bn('1000000e18')
        let lendingPool: ILendingPool

        beforeEach(async () => {
          initialBal = bn('2000000e18')

          // aDAI
          await whileImpersonating(holderADAI, async (adaiSigner) => {
            // Wrap ADAI into static ADAI
            await aDai.connect(adaiSigner).transfer(addr1.address, initialBal)
            await aDai.connect(addr1).approve(stataDai.address, initialBal)
            await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, false)
          })

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
            await ethers.getContractAt(
              'ILendingPool',
              networkConfig[chainId].AAVE_LENDING_POOL || ''
            )
          )

          // Get current liquidity
          fullLiquidityAmt = await dai.balanceOf(aDai.address)

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
            await facadeInvariantMonitor.backingReedemable(
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
        })

        it('Should return backing redeemable percent correctly', async function () {
          // AAVE V2 - All redeemable
          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V2,
              stataDai.address
            )
          ).to.equal(fp('1'))

          // Leave only 80% of backing available to be redeemed
          const borrowAmount = fullLiquidityAmt.sub(issueAmount.mul(80).div(100))
          await lendingPool.connect(addr1).borrow(dai.address, borrowAmount, 2, 0, addr1.address)

          expect(
            await facadeInvariantMonitor.backingReedemable(
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
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V2,
              stataDai.address
            )
          ).to.be.closeTo(fp('0.40'), fp('0.01'))

          // Confirm we cannot redeemd full balance
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
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V2,
              stataDai.address
            )
          ).to.equal(fp('1'))

          // Borrow full liquidity
          await lendingPool
            .connect(addr1)
            .borrow(dai.address, fullLiquidityAmt, 2, 0, addr1.address)

          expect(
            await facadeInvariantMonitor.backingReedemable(
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
          initialBal = bn('10000000e6')

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
          const usdcOracleError = baseL2Chains.includes(hre.network.name)
            ? fp('0.003')
            : fp('0.0025') // 0.3% (Base) or 0.25%

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

          // Fund user
          await whileImpersonating(holderaUSDCV3, async (ausdcV3Signer) => {
            // Wrap AUSDC V3 into static AUSDC
            await aUsdcV3.connect(ausdcV3Signer).transfer(addr1.address, initialBal)
            await aUsdcV3.connect(addr1).approve(stataUsdcV3.address, initialBal)
            await stataUsdcV3
              .connect(addr1)
              ['deposit(uint256,address,uint16,bool)'](initialBal, addr1.address, 0, false)
          })

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

          pool = <IPool>(
            await ethers.getContractAt('IPool', networkConfig[chainId].AAVE_V3_POOL || '')
          )

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
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V3,
              stataUsdcV3.address
            )
          ).to.equal(fp('1'))

          // Confirm all can be redeemd
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
          await expect(pool.connect(addr2).withdraw(usdc.address, MAX_UINT256, addr2.address)).to
            .not.be.reverted
          expect(await usdc.balanceOf(addr2.address)).to.be.gt(bn(0))
        })

        it('Should return backing redeemable percent correctly', async function () {
          // AAVE V3 - All redeemable
          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V3,
              stataUsdcV3.address
            )
          ).to.equal(fp('1'))

          // Leave only 80% of backing to be able to be redeemed
          const borrowAmount = fullLiquidityAmt.sub(toBNDecimals(issueAmount, 6).mul(80).div(100))
          await pool.connect(addr1).borrow(usdc.address, borrowAmount, 2, 0, addr1.address)

          expect(
            await facadeInvariantMonitor.backingReedemable(
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

          // Only 40% available to be redeemd
          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V3,
              stataUsdcV3.address
            )
          ).to.be.closeTo(fp('0.40'), fp('0.01'))

          // Confirm we cannot redeemd full balance
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
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V3,
              stataUsdcV3.address
            )
          ).to.equal(fp('1'))

          // Borrow full liquidity
          await pool.connect(addr1).borrow(usdc.address, fullLiquidityAmt, 2, 0, addr1.address)

          expect(
            await facadeInvariantMonitor.backingReedemable(
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
          initialBal = bn('2000000e18')

          // cDAI
          await whileImpersonating(holderCDAI, async (cdaiSigner) => {
            await cDai
              .connect(cdaiSigner)
              .transfer(addr1.address, toBNDecimals(initialBal, 8).mul(100))
            await cDai
              .connect(addr1)
              .approve(cDaiVault.address, toBNDecimals(initialBal, 8).mul(100))
            await cDaiVault
              .connect(addr1)
              .deposit(toBNDecimals(initialBal, 8).mul(100), addr1.address)
          })

          // Setup basket
          await basketHandler.connect(owner).setPrimeBasket([cDaiVault.address], [fp('1')])
          await basketHandler.connect(owner).refreshBasket()
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Provide approvals
          await cDaiVault
            .connect(addr1)
            .approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

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
          const cEth = await ethers.getContractAt(
            cEtherAbi,
            networkConfig[chainId].tokens.cETH || ''
          )
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
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.equal(fp('1'))

          // Confirm all can be redeemd
          expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
          const bmBalanceAmt = await cDaiVault.balanceOf(backingManager.address)
          await whileImpersonating(backingManager.address, async (bmSigner) => {
            await cDaiVault.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
          })
          await cDaiVault.connect(addr2).withdraw(bmBalanceAmt, addr2.address)
          expect(await cDai.balanceOf(addr2.address)).to.equal(bmBalanceAmt)

          await expect(cDai.connect(addr2).redeem(bmBalanceAmt)).to.not.be.reverted
          expect(await dai.balanceOf(addr2.address)).to.be.gt(bn(0))
        })

        it('Should return backing redeemable percent correctly', async function () {
          // COMPOUND V2 - All redeemable
          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.equal(fp('1'))

          // Leave only 80% of backing to be able to be redeemed
          const borrowAmount = fullLiquidityAmt.sub(issueAmount.mul(80).div(100))
          await cDai.connect(addr1).borrow(borrowAmount)

          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.be.closeTo(fp('0.80'), fp('0.01'))

          // Borrow half of the remaining liquidity
          const remainingLiquidity = fullLiquidityAmt.sub(borrowAmount)
          await cDai.connect(addr1).borrow(bn(remainingLiquidity.div(2)))

          // Now only 40% of backing can be redeemed
          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.be.closeTo(fp('0.40'), fp('0.01'))

          // Confirm we cannot redeemd full balance
          expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
          const bmBalanceAmt = await cDaiVault.balanceOf(backingManager.address)
          await whileImpersonating(backingManager.address, async (bmSigner) => {
            await cDaiVault.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
          })
          await cDaiVault.connect(addr2).withdraw(bmBalanceAmt, addr2.address)
          await expect(cDai.connect(addr2).redeem(bmBalanceAmt)).to.be.reverted
          expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))

          //  We can redeem iff we reduce to 30%
          await expect(cDai.connect(addr2).redeem(bmBalanceAmt.mul(30).div(100))).to.not.be.reverted
          expect(await dai.balanceOf(addr2.address)).to.be.gt(0)
        })

        it('Should handle no liquidity', async function () {
          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.equal(fp('1'))

          // Borrow full liquidity
          await cDai.connect(addr1).borrow(fullLiquidityAmt)

          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.be.closeTo(fp('0'), fp('0.01'))

          // Confirm we cannot redeem anything, not even 1%
          expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
          const bmBalanceAmt = await cDaiVault.balanceOf(backingManager.address)
          await whileImpersonating(backingManager.address, async (bmSigner) => {
            await cDaiVault.connect(bmSigner).transfer(addr2.address, bmBalanceAmt)
          })
          await cDaiVault.connect(addr2).withdraw(bmBalanceAmt, addr2.address)
          expect(await cDai.balanceOf(addr2.address)).to.equal(bmBalanceAmt)

          await expect(cDai.connect(addr2).redeem((await cDai.balanceOf(addr2.address)).div(100)))
            .to.be.reverted
          expect(await dai.balanceOf(addr2.address)).to.equal(bn(0))
        })
      })
    })
  }
)
