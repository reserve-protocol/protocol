import forkBlockNumber from '#/test/integration/fork-block-numbers'
import { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { whileImpersonating } from '../../../../utils/impersonation'
import { bn, fp } from '../../../../../common/numbers'
import {
  CurveGaugeWrapper,
  CurvePoolMock,
  CurveMetapoolMock,
  ERC20Mock,
  ICurvePool,
  MockV3Aggregator,
} from '../../../../../typechain'
import { getResetFork } from '../../helpers'
import {
  CRV,
  DAI,
  USDC,
  USDT,
  MIM,
  THREE_POOL,
  THREE_POOL_GAUGE,
  THREE_POOL_TOKEN,
  WBTC,
  WETH,
  TRI_CRYPTO,
  TRI_CRYPTO_GAUGE,
  TRI_CRYPTO_TOKEN,
  FRAX,
  FRAX_BP,
  eUSD,
  eUSD_FRAX_BP,
  eUSD_GAUGE,
  eUSD_FRAX_HOLDER,
  MIM_THREE_POOL,
  MIM_THREE_POOL_GAUGE,
  MIM_THREE_POOL_HOLDER,
} from '../constants'
import { CurveBase } from '../pluginTestTypes'

export interface Wrapped3PoolFixtureStable extends CurveBase {
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

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('CurveGaugeWrapper')
  const wrapper = await wrapperFactory.deploy(
    THREE_POOL_TOKEN,
    'Wrapped Staked Curve.fi DAI/USDC/USDT',
    'ws3Crv',
    CRV,
    THREE_POOL_GAUGE
  )

  return {
    dai,
    usdc,
    usdt,
    curvePool,
    wrapper,
  }
}

export interface Wrapped3PoolFixtureVolatile extends CurveBase {
  usdt: ERC20Mock
  wbtc: ERC20Mock
  weth: ERC20Mock
}

export const makeWTricryptoPoolVolatile = async (): Promise<Wrapped3PoolFixtureVolatile> => {
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

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('CurveGaugeWrapper')
  const wrapper = await wrapperFactory.deploy(
    TRI_CRYPTO_TOKEN,
    'Wrapped Curve.fi USD-BTC-ETH',
    'wcrv3crypto',
    CRV,
    TRI_CRYPTO_GAUGE
  )

  return {
    usdt,
    wbtc,
    weth,
    curvePool,
    wrapper,
  }
}

export const mintWPool = async (
  ctx: CurveBase,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string,
  holder: string
) => {
  const wrapper = ctx.wrapper as CurveGaugeWrapper
  const lpToken = await ethers.getContractAt(
    '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
    await wrapper.underlying()
  )
  await whileImpersonating(holder, async (signer) => {
    await lpToken.connect(signer).transfer(user.address, amount)
  })

  await lpToken.connect(user).approve(wrapper.address, amount)
  await wrapper.connect(user).deposit(amount, recipient)
}

export const resetFork = getResetFork(forkBlockNumber['old-curve-plugins'])

export type Numeric = number | bigint

export const exp = (i: Numeric, d: Numeric = 0): bigint => {
  return BigInt(i) * 10n ** BigInt(d)
}

// ===== eUSD / fraxBP

export interface WrappedEUSDFraxBPFixture {
  usdc: ERC20Mock
  frax: ERC20Mock
  eusd: ERC20Mock
  metapoolToken: CurveMetapoolMock
  realMetapool: CurveMetapoolMock
  curvePool: ICurvePool
  wPool: CurveGaugeWrapper
}

export const makeWeUSDFraxBP = async (
  eusdFeed: MockV3Aggregator
): Promise<WrappedEUSDFraxBPFixture> => {
  // Make a fake RTokenAsset and register it with eUSD's assetRegistry
  const AssetFactory = await ethers.getContractFactory('Asset')
  const mockRTokenAsset = await AssetFactory.deploy(
    bn('604800'),
    eusdFeed.address,
    fp('0.01'),
    eUSD,
    fp('1e6'),
    bn('604800')
  )
  const eUSDAssetRegistry = await ethers.getContractAt(
    'IAssetRegistry',
    '0x9B85aC04A09c8C813c37de9B3d563C2D3F936162'
  )
  await whileImpersonating('0xc8Ee187A5e5c9dC9b42414Ddf861FFc615446a2c', async (signer) => {
    await eUSDAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
  })

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
  const metapoolToken = <CurveMetapoolMock>(
    await CurveMetapoolMockFactory.deploy(
      [await realMetapool.balances(0), await realMetapool.balances(1)],
      [await realMetapool.coins(0), await realMetapool.coins(1)]
    )
  )
  await metapoolToken.setVirtualPrice(await realMetapool.get_virtual_price())
  await metapoolToken.mint(eUSD_FRAX_HOLDER, await realMetapool.balanceOf(eUSD_FRAX_HOLDER))

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('CurveGaugeWrapper')
  const wrapper = await wrapperFactory.deploy(
    eUSD_FRAX_BP,
    'Wrapped Curve eUSD+FRAX/USDC',
    'weUSDFRAXBP',
    CRV,
    eUSD_GAUGE
  )

  return { usdc, frax, eusd, metapoolToken, realMetapool, curvePool, wPool: wrapper }
}

export const mintWeUSDFraxBP = async (
  ctx: CurveBase,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string,
  holder: string
) => {
  const wrapper = ctx.wrapper as CurveGaugeWrapper
  const lpToken = await ethers.getContractAt(
    '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
    await wrapper.underlying()
  )
  await whileImpersonating(holder, async (signer) => {
    await lpToken.connect(signer).transfer(user.address, amount)
  })

  await lpToken.connect(user).approve(wrapper.address, amount)
  await wrapper.connect(user).deposit(amount, recipient)
}

// === MIM + 3Pool

export interface WrappedMIM3PoolFixture {
  dai: ERC20Mock
  usdc: ERC20Mock
  usdt: ERC20Mock
  mim: ERC20Mock
  metapoolToken: CurveMetapoolMock
  realMetapool: CurveMetapoolMock
  curvePool: ICurvePool
  wPool: CurveGaugeWrapper
}

export const makeWMIM3Pool = async (): Promise<WrappedMIM3PoolFixture> => {
  // Use real reference ERC20s
  const dai = await ethers.getContractAt('ERC20Mock', DAI)
  const usdc = await ethers.getContractAt('ERC20Mock', USDC)
  const usdt = await ethers.getContractAt('ERC20Mock', USDT)
  const mim = await ethers.getContractAt('ERC20Mock', MIM)

  // Use real MIM pool
  const curvePool = await ethers.getContractAt('ICurvePool', THREE_POOL)

  // Use mock curvePool seeded with initial balances
  const CurveMetapoolMockFactory = await ethers.getContractFactory('CurveMetapoolMock')
  const realMetapool = <CurveMetapoolMock>(
    await ethers.getContractAt('CurveMetapoolMock', MIM_THREE_POOL)
  )
  const metapoolToken = <CurveMetapoolMock>(
    await CurveMetapoolMockFactory.deploy(
      [await realMetapool.balances(0), await realMetapool.balances(1)],
      [await realMetapool.coins(0), await realMetapool.coins(1)]
    )
  )
  await metapoolToken.setVirtualPrice(await realMetapool.get_virtual_price())
  await metapoolToken.mint(
    MIM_THREE_POOL_HOLDER,
    await realMetapool.balanceOf(MIM_THREE_POOL_HOLDER)
  )
  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('CurveGaugeWrapper')
  const wrapper = await wrapperFactory.deploy(
    MIM_THREE_POOL,
    'Wrapped Curve MIM+3Pool',
    'wMIM3CRV',
    CRV,
    MIM_THREE_POOL_GAUGE
  )

  return { dai, usdc, usdt, mim, metapoolToken, realMetapool, curvePool, wPool: wrapper }
}

export const mintWMIM3Pool = async (
  ctx: CurveBase,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string,
  holder: string
) => {
  const wrapper = ctx.wrapper as CurveGaugeWrapper
  const lpToken = await ethers.getContractAt(
    '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20',
    await wrapper.underlying()
  )
  await whileImpersonating(holder, async (signer) => {
    await lpToken.connect(signer).transfer(user.address, amount)
  })

  await lpToken.connect(user).approve(ctx.wrapper.address, amount)
  await wrapper.connect(user).deposit(amount, recipient)
}
