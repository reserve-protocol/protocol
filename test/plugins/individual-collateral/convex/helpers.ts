import { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { whileImpersonating } from '../../../utils/impersonation'
import { ConvexStakingWrapper, CurvePoolMock, ERC20Mock } from '../../../../typechain'
import { getResetFork } from '../helpers'
import {
  DAI,
  USDC,
  USDT,
  THREE_POOL,
  THREE_POOL_TOKEN,
  CVX_POOL_ID,
  CVX_3CRV,
  THREE_POOL_HOLDER,
  FORK_BLOCK,
} from './constants'

// export const ORACLE_TIMEOUT = 86400n // 24 hours in seconds
// export const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
// export const DELAY_UNTIL_DEFAULT = 86400n
// export const MAX_TRADE_VOL = 1000000n
// export const FIX_ONE = 1n * 10n ** 18n

//

export interface Wrapped3PoolFixture {
  curvePool: CurvePoolMock
  crv3Pool: ERC20Mock
  cvx3Pool: ERC20Mock
  w3Pool: ConvexStakingWrapper
  dai: ERC20Mock
  usdc: ERC20Mock
  usdt: ERC20Mock
}

export const makeW3Pool = async (): Promise<Wrapped3PoolFixture> => {
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
  // TODO return to this decision

  // Use real Curve/Convex contracts
  const crv3Pool = <ERC20Mock>await ethers.getContractAt('ERC20Mock', THREE_POOL_TOKEN)
  const cvx3Pool = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX_3CRV)

  // Deploy Wrapper
  const wrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper')
  const w3Pool = await wrapperFactory.deploy()
  await w3Pool.initialize(CVX_POOL_ID)

  return { dai, usdc, usdt, curvePool, crv3Pool, cvx3Pool, w3Pool }
}

export const mintW3Pool = async (
  ctx: Wrapped3PoolFixture,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  const initBal = await ctx.crv3Pool.balanceOf(user.address)

  await whileImpersonating(THREE_POOL_HOLDER, async (signer) => {
    await ctx.crv3Pool.connect(signer).transfer(user.address, amount)
  })

  await ctx.w3Pool.connect(user).deposit(initBal.sub(amount), recipient)
}

export const resetFork = getResetFork(FORK_BLOCK)

// export type Numeric = number | bigint

// export const exp = (i: Numeric, d: Numeric = 0): bigint => {
//   return BigInt(i) * 10n ** BigInt(d)
// }

// export const resetFork = async () => {
//   // Need to reset state since running the whole test suites to all
//   // test cases in this file to fail. Strangely, all test cases
//   // pass when running just this file alone.
//   await hre.network.provider.request({
//     method: 'hardhat_reset',
//     params: [
//       {
//         forking: {
//           jsonRpcUrl: process.env.MAINNET_RPC_URL,
//           blockNumber: 16074053,
//         },
//       },
//     ],
//   })
// }

// type ImpersonationFunction<T> = (signer: SignerWithAddress) => Promise<T>

// /* whileImpersonating(address, f):

//    Set up `signer` to be an ethers transaction signer that impersonates the account address
//    `address`. In that context, call f(signer). `address` can be either a contract address or an
//    external account, so you can use often this instead of building entire mock contracts.

//    Example usage:

//    await whileImpersonating(basketHandler.address, async (signer) => {
//      await expect(rToken.connect(signer).setBasketsNeeded(fp('1'))
//      .to.emit(rToken, 'BasketsNeededChanged')
//    })

//    This does the following:
//    - Sets the basketHandler Eth balance to 2^256-1 (so it has plenty of gas)
//    - Calls rToken.setBasketsNeeded _as_ the basketHandler contract,
//    - Checks that that call emits the event 'BasketNeededChanged'
// */
// export const whileImpersonating = async (address: string, f: ImpersonationFunction<void>) => {
//   // Set maximum ether balance at address
//   await hre.network.provider.request({
//     method: 'hardhat_setBalance',
//     params: [address, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
//   })
//   const signer = await ethers.getImpersonatedSigner(address)

//   await f(signer)
// }
