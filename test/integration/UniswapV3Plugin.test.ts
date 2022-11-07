import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish, utils, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral, defaultFixture, IMPLEMENTATION } from '../fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { networkConfig } from '../../common/configuration'
import { bn, toBNDecimals } from '../../common/numbers'
import {
  ERC20Mock,
  UniswapV3Wrapper,
  USDCMock,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'
import { waitForTx } from './utils'

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'
const holderUSDC = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV3Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {

  const initialBal: BigNumber = bn('20000e18')
  let addr1: SignerWithAddress

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
      ;[, , , addr1] = await ethers.getSigners()
      await loadFixture(defaultFixture)
      dai = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI!)
      )
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr1.address, initialBal)
      })
      usdc = <USDCMock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC!)
      )
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })
      usdt = <USDCMock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDT || '')
      )
      await whileImpersonating(holderUSDT, async (usdtSigner) => {
        await usdt.connect(usdtSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })
    })

    it('Constructed', async () => {
      type TMintParams = {
        token0: string;
        token1: string;
        fee: BigNumberish;
        tickLower: BigNumberish;
        tickUpper: BigNumberish;
        amount0Desired: BigNumberish;
        amount1Desired: BigNumberish;
        amount0Min: BigNumberish;
        amount1Min: BigNumberish;
        recipient: string;
        deadline: BigNumberish;
      }

      /// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128
      const MIN_TICK = -887272;
      /// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128
      const MAX_TICK = -MIN_TICK;

      let mintParams: TMintParams = {
        token0: networkConfig[chainId].tokens.DAI!,
        token1: networkConfig[chainId].tokens.USDC!,
        fee: 3000,
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        amount0Desired: 1000, //bn('1e18'),
        amount1Desired: 1000, //toBNDecimals(bn('1e18'), 6),
        amount0Min: 0, //require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'Price slippage check');
        amount1Min: 0,
        recipient: '0x0000000000000000000000000000000000000000', // rewrite in constructor
        deadline: 0 //rewrite in constructor
      }

      console.log('balance', await addr1.getBalance());
      console.log('usdt', await usdt.balanceOf(await addr1.getAddress()));
      console.log('usdc', await usdc.balanceOf(await addr1.getAddress()));
      console.log('dai', await dai.balanceOf(await addr1.getAddress()));

      const DEFAULT_GAS_LIMIT = 10000000
      const DEFAULT_GAS_PRICE = utils.parseUnits('100', 'gwei')
      const defaultTxParams = { gasLimit: DEFAULT_GAS_LIMIT, gasPrice: DEFAULT_GAS_PRICE }
      
      const UniswapV3WrapperContractFactory = await ethers.getContractFactory('UniswapV3Wrapper')
      const uniswapV3Wrapper: UniswapV3Wrapper = <UniswapV3Wrapper>(
        await UniswapV3WrapperContractFactory.connect(addr1).deploy(
          "UniswapV3WrapperToken",
          "U3W",
          defaultTxParams
        )
      )
      await waitForTx(await dai.approve(uniswapV3Wrapper.address, mintParams.amount0Desired, defaultTxParams))
      await waitForTx(await usdc.approve(uniswapV3Wrapper.address, mintParams.amount1Desired, defaultTxParams))
      await uniswapV3Wrapper.mint(mintParams);
    })
  })
})
