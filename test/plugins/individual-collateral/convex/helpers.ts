import { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { whileImpersonating } from '../../../utils/impersonation'
import {
  ConvexStakingWrapper,
  CurvePoolMock,
  CurveMetapoolMock,
  ERC20Mock,
  ICurvePool,
} from '../../../../typechain'
import { getResetFork } from '../helpers'
import {
  DAI,
  USDC,
  USDT,
  THREE_POOL,
  THREE_POOL_TOKEN,
  THREE_POOL_CVX_POOL_ID,
  FORK_BLOCK,
  WBTC,
  WETH,
  TRI_CRYPTO,
  TRI_CRYPTO_TOKEN,
  TRI_CRYPTO_CVX_POOL_ID,
  FRAX,
  FRAX_BP,
  eUSD,
  eUSD_FRAX_BP,
  eUSD_FRAX_BP_POOL_ID,
  eUSD_FRAX_HOLDER,
} from './constants'

interface WrappedPoolBase {
  curvePool: CurvePoolMock
  crv3Pool: ERC20Mock
  w3Pool: ConvexStakingWrapper
}

export interface Wrapped3PoolFixtureStable extends WrappedPoolBase {
  dai: ERC20Mock
  usdc: ERC20Mock
  usdt: ERC20Mock
}

export const makeW3PoolStable = async (): Promise<Wrapped3PoolFixtureStable> => {
  // Use real reference ERC20s
  const dai = await ethers.getContractAt('ERC20Mock', DAI)
  const usdc = await ethers.getContractAt('ERC20Mock', USDC)
  const usdt = await ethers.getContractAt('ERC20Mock', USDT)

  // Use mock curvePool seeded with initial balances
  const CurvePoolMockFactory = await ethers.getContractFactory('CurvePoolMock')
  const realCurvePool = <CurvePoolMock>await ethers.getContractAt('CurvePoolMock', THREE_POOL)
  const curvePool = <CurvePoolMock>(
    await CurvePoolMockFactory.deploy(
      [
        await realCurvePool.balances(0),
        await realCurvePool.balances(1),
        await realCurvePool.balances(2),
      ],
      [await realCurvePool.coins(0), await realCurvePool.coins(1), await realCurvePool.coins(2)]
    )
  )
  await curvePool.setVirtualPrice(await realCurvePool.get_virtual_price())

  // Use real Curve/Convex contracts
  const crv3Pool = <ERC20Mock>await ethers.getContractAt('ERC20Mock', THREE_POOL_TOKEN)

  // Deploy external cvxMining lib
  const CvxMiningFactory = await ethers.getContractFactory('CvxMining')
  const cvxMining = await CvxMiningFactory.deploy()

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: cvxMining.address },
  })
  const w3Pool = await wrapperFactory.deploy()
  await w3Pool.initialize(THREE_POOL_CVX_POOL_ID)

  return { dai, usdc, usdt, curvePool, crv3Pool, w3Pool }
}

export interface Wrapped3PoolFixtureVolatile extends WrappedPoolBase {
  usdt: ERC20Mock
  wbtc: ERC20Mock
  weth: ERC20Mock
}

export const makeW3PoolVolatile = async (): Promise<Wrapped3PoolFixtureVolatile> => {
  // Use real reference ERC20s
  const usdt = await ethers.getContractAt('ERC20Mock', USDT)
  const wbtc = await ethers.getContractAt('ERC20Mock', WBTC)
  const weth = await ethers.getContractAt('ERC20Mock', WETH)

  // Use mock curvePool seeded with initial balances
  const CurvePoolMockFactory = await ethers.getContractFactory('CurvePoolMock')
  const realCurvePool = <CurvePoolMock>await ethers.getContractAt('CurvePoolMock', TRI_CRYPTO)
  const curvePool = <CurvePoolMock>(
    await CurvePoolMockFactory.deploy(
      [
        await realCurvePool.balances(0),
        await realCurvePool.balances(1),
        await realCurvePool.balances(2),
      ],
      [await realCurvePool.coins(0), await realCurvePool.coins(1), await realCurvePool.coins(2)]
    )
  )
  await curvePool.setVirtualPrice(await realCurvePool.get_virtual_price())

  // Use real Curve/Convex contracts
  const crv3Pool = <ERC20Mock>await ethers.getContractAt('ERC20Mock', TRI_CRYPTO_TOKEN)

  // Deploy external cvxMining lib
  const CvxMiningFactory = await ethers.getContractFactory('CvxMining')
  const cvxMining = await CvxMiningFactory.deploy()

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: cvxMining.address },
  })
  const w3Pool = await wrapperFactory.deploy()
  await w3Pool.initialize(TRI_CRYPTO_CVX_POOL_ID)

  return { usdt, wbtc, weth, curvePool, crv3Pool, w3Pool }
}

export const mintW3Pool = async (
  ctx: WrappedPoolBase,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string,
  holder: string
) => {
  await whileImpersonating(holder, async (signer) => {
    await ctx.crv3Pool.connect(signer).transfer(user.address, amount)
  })

  await ctx.crv3Pool.connect(user).approve(ctx.w3Pool.address, amount)
  await ctx.w3Pool.connect(user).deposit(amount, recipient)
}

export const resetFork = getResetFork(FORK_BLOCK)

export type Numeric = number | bigint

export const exp = (i: Numeric, d: Numeric = 0): bigint => {
  return BigInt(i) * 10n ** BigInt(d)
}

// ===== eUSD / fraxBP

export interface WrappedEUSDFraxBPFixture {
  usdc: ERC20Mock
  frax: ERC20Mock
  eusd: ERC20Mock
  metapool: CurveMetapoolMock
  realMetapool: CurveMetapoolMock
  curvePool: ICurvePool
  wPool: ConvexStakingWrapper
}

export const makeWeUSDFraxBP = async (): Promise<WrappedEUSDFraxBPFixture> => {
  // Use real reference ERC20s
  const usdc = await ethers.getContractAt('ERC20Mock', USDC)
  const frax = await ethers.getContractAt('ERC20Mock', FRAX)
  const eusd = await ethers.getContractAt('ERC20Mock', eUSD)

  // Use real fraxBP pool
  const curvePool = await ethers.getContractAt('ICurvePool', FRAX_BP)

  // Use mock curvePool seeded with initial balances
  const CurveMetapoolMockFactory = await ethers.getContractFactory('CurveMetapoolMock')
  const realMetapool = <CurveMetapoolMock>(
    await ethers.getContractAt('CurveMetapoolMock', eUSD_FRAX_BP)
  )
  const metapool = <CurveMetapoolMock>(
    await CurveMetapoolMockFactory.deploy(
      [await realMetapool.balances(0), await realMetapool.balances(1)],
      [await realMetapool.coins(0), await realMetapool.coins(1)]
    )
  )
  await metapool.setVirtualPrice(await realMetapool.get_virtual_price())
  await metapool.mint(eUSD_FRAX_HOLDER, await realMetapool.balanceOf(eUSD_FRAX_HOLDER))

  // Deploy external cvxMining lib
  const CvxMiningFactory = await ethers.getContractFactory('CvxMining')
  const cvxMining = await CvxMiningFactory.deploy()

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: cvxMining.address },
  })
  const wPool = await wrapperFactory.deploy()
  await wPool.initialize(eUSD_FRAX_BP_POOL_ID)

  return { usdc, frax, eusd, metapool, realMetapool, curvePool, wPool }
}

export const mintWeUSDFraxBP = async (
  ctx: WrappedEUSDFraxBPFixture,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string,
  holder: string
) => {
  await whileImpersonating(holder, async (signer) => {
    await ctx.realMetapool.connect(signer).transfer(user.address, amount)
  })

  await ctx.realMetapool.connect(user).approve(ctx.wPool.address, amount)
  await ctx.wPool.connect(user).deposit(amount, recipient)
}
