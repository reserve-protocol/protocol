import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { defaultFixture, IMPLEMENTATION } from '../fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { networkConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import {
  ERC20Mock,
  MockV3Aggregator,
  UniswapV3Wrapper,
  USDCMock,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'
import { waitForTx } from './utils'
import { expect } from 'chai'
import { adjustedAmout, deployUniswapV3Wrapper, logBalances, MAX_TICK, MIN_TICK, TMintParams } from './common'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../common/constants'
import { UniswapV3Collateral__factory } from '@typechain/factories/UniswapV3Collateral__factory'
import { UniswapV3Collateral } from '@typechain/UniswapV3Collateral'

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'
const holderUSDC = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV3Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {

  const initialBal = 20000
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens and Assets
  let dai: ERC20Mock
  let usdc: USDCMock
  let usdt: ERC20Mock

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  describe('Assets/Collateral', () => {
    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[, , addr1, addr2] = await ethers.getSigners()
      await loadFixture(defaultFixture)
      dai = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI!)
      )
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr1.address, await adjustedAmout(dai, initialBal))
      })
      usdc = <USDCMock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC!)
      )
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr1.address, await adjustedAmout(usdc, initialBal))
      })
      usdt = <USDCMock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDT || '')
      )
      await whileImpersonating(holderUSDT, async (usdtSigner) => {
        await usdt.connect(usdtSigner).transfer(addr1.address, await adjustedAmout(usdt, initialBal))
      })
    })

    it('U3W can be minted', async () => {
      const asset0 = dai;
      const asset1 = usdc;

      const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3Wrapper(addr1)


      let mintParams: TMintParams = {
        token0: asset0.address,
        token1: asset1.address,
        fee: 100,
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        amount0Desired: await adjustedAmout(asset0, 100),
        amount1Desired: await adjustedAmout(asset1, 100),
        amount0Min: 0, //require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'Price slippage check');
        amount1Min: 0,
        recipient: ZERO_ADDRESS,
        deadline: 0 //rewrite in constructor
      }

      await waitForTx(await asset0.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount0Desired))
      await waitForTx(await asset1.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount1Desired))
      await waitForTx(await uniswapV3Wrapper.connect(addr1).mint(mintParams))

    })

    it('Holders can remove liquidity permissionlessly', async () => {

      const asset0 = dai;
      const asset1 = usdc;

      let mintParams: TMintParams = {
        token0: asset0.address,
        token1: asset1.address,
        fee: 100,
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        amount0Desired: await adjustedAmout(asset0, 100),
        amount1Desired: await adjustedAmout(asset1, 100),
        amount0Min: 0,
        amount1Min: 0,
        recipient: ZERO_ADDRESS,
        deadline: 0
      }

      const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3Wrapper(addr1)

      await logBalances("Balances before UniswapV3Wrapper mint:",
        [addr1], [asset0, usdc, uniswapV3Wrapper]);

      expect(await asset0.balanceOf(addr1.address)).to.be.eq(await adjustedAmout(asset0, initialBal))
      expect(await asset0.balanceOf(addr2.address)).to.be.eq(bn('0'))
      expect(await asset1.balanceOf(addr1.address)).to.be.eq(await adjustedAmout(asset1, initialBal))
      expect(await asset1.balanceOf(addr2.address)).to.be.eq(bn('0'))

      await waitForTx(await asset0.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount0Desired));
      await waitForTx(await asset1.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount1Desired))
      await waitForTx(await uniswapV3Wrapper.mint(mintParams));

      await logBalances("Balances after UniswapV3Wrapper mint:",
        [addr1], [asset0, asset1, uniswapV3Wrapper]);

      expect(await asset0.balanceOf(addr1.address)).to.be.closeTo(
        await adjustedAmout(asset0, 19900),
        await adjustedAmout(asset0, 1)
      )
      expect(await asset0.balanceOf(addr2.address)).to.be.eq(
        bn('0')
      )
      expect(await asset1.balanceOf(addr1.address)).to.be.closeTo(
        await adjustedAmout(asset1, 19900),
        await adjustedAmout(asset1, 1)
      )

      expect(await asset1.balanceOf(addr2.address)).to.be.eq(
        bn('0')
      )

      let positions = await uniswapV3Wrapper.positions();
      const liquidityToTransfer = positions.liquidity.div(4)

      await waitForTx(await uniswapV3Wrapper.connect(addr1)
        .transfer(addr2.address, liquidityToTransfer)
      )
      await logBalances("Balances after liquidity transfer:",
        [addr1, addr2], [asset0, asset1, uniswapV3Wrapper]);

      let balance1 = await uniswapV3Wrapper.balanceOf(addr1.address);
      expect(balance1).to.be.eq(
        positions.liquidity.sub(liquidityToTransfer)
      )

      expect(await uniswapV3Wrapper.balanceOf(addr2.address)).to.be.eq(
        liquidityToTransfer
      )

      await waitForTx(await uniswapV3Wrapper.connect(addr1)
        .decreaseLiquidity(liquidityToTransfer)
      )
      await logBalances("add1 decreased liquidity:",
        [addr1, addr2], [asset0, asset1, uniswapV3Wrapper]);

      expect(await uniswapV3Wrapper.balanceOf(addr1.address)).to.be.closeTo(
        positions.liquidity.div(2), 10 ** 6
      )

      expect(await asset0.balanceOf(addr1.address)).to.be.closeTo(
        await adjustedAmout(asset0, 19925),
        await adjustedAmout(asset0, 1)
      )

      expect(await asset1.balanceOf(addr1.address)).to.be.closeTo(
        await adjustedAmout(asset1, 19925),
        await adjustedAmout(asset1, 1)
      )

      await waitForTx(await uniswapV3Wrapper.connect(addr2)
        .decreaseLiquidity(liquidityToTransfer)
      )

      await logBalances("add2 decreased liquidity:",
        [addr1, addr2], [dai, usdc, uniswapV3Wrapper]);

      expect(await uniswapV3Wrapper.balanceOf(addr2.address)).to.be.eq(bn('0'))

      expect(await asset0.balanceOf(addr2.address)).to.be.closeTo(
        await adjustedAmout(asset0, 25),
        await adjustedAmout(asset0, 1)
      )
      expect(await asset1.balanceOf(addr2.address)).to.be.closeTo(
        await adjustedAmout(asset1, 25),
        await adjustedAmout(asset1, 1)
      )
    })

    it('U3C can be deployed', async () => {
      const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
      const ORACLE_TIMEOUT = bn('281474976710655').div(2) // type(uint48).max / 2
      const RTOKEN_MAX_TRADE_VALUE = fp('1e6')

      const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3Wrapper(addr1)
      const asset0 = dai;
      const asset1 = usdc;

      let mintParams: TMintParams = {
        token0: asset0.address,
        token1: asset1.address,
        fee: 100, //0.01%
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        amount0Desired: await adjustedAmout(asset0, 100),
        amount1Desired: await adjustedAmout(asset1, 100),
        amount0Min: 0,
        amount1Min: 0,
        recipient: ZERO_ADDRESS,
        deadline: 0
      }
      await waitForTx(await asset0.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount0Desired));
      await waitForTx(await asset1.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount1Desired))
      await waitForTx(await uniswapV3Wrapper.mint(mintParams));

      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const mockChainlinkFeed0 = <MockV3Aggregator>await MockV3AggregatorFactory.connect(addr1).deploy(
        await dai.decimals(), bn('1e8')
      )
      const mockChainlinkFeed1 = <MockV3Aggregator>await MockV3AggregatorFactory.connect(addr1).deploy(
        await usdc.decimals(), bn('1e8')
      )

      const uniswapV3CollateralContractFactory: UniswapV3Collateral__factory = await ethers.getContractFactory('UniswapV3Collateral')

      const fallbackPrice = fp('1');
      const targetName = ethers.utils.formatBytes32String('USD');
      const uniswapV3Collateral: UniswapV3Collateral = <UniswapV3Collateral>(
        await uniswapV3CollateralContractFactory.connect(addr1).deploy(
          fallbackPrice,
          mockChainlinkFeed0.address,
          mockChainlinkFeed1.address,
          uniswapV3Wrapper.address,
          RTOKEN_MAX_TRADE_VALUE,
          ORACLE_TIMEOUT,
          targetName,
          DELAY_UNTIL_DEFAULT
        )
      )

      expect(await uniswapV3Collateral.isCollateral()).to.equal(true)
      expect(await uniswapV3Collateral.erc20()).to.equal(uniswapV3Wrapper.address)
      expect(await uniswapV3Collateral.erc20Decimals()).to.equal(18)
      expect(await uniswapV3Collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await uniswapV3Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await uniswapV3Collateral.whenDefault()).to.equal(MAX_UINT256)
      //expect(await uniswapV3Collateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await uniswapV3Collateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await uniswapV3Collateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
      expect(await uniswapV3Collateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await uniswapV3Collateral.refPerTok()).to.equal(fp('1'))
      expect(await uniswapV3Collateral.targetPerRef()).to.equal(fp('1'))
      expect(await uniswapV3Collateral.pricePerTarget()).to.equal(fp('1'))
      expect(await uniswapV3Collateral.strictPrice()).to.equal(fp('200'))
      //expect(await uniswapV3Collateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await uniswapV3Collateral.bal(addr1.address)).to.equal(await adjustedAmout(uniswapV3Wrapper, 100))
    })
  })


})

//TODO check that fees earned remain intact after decreaseLiquidity calls

