import { expect, assert } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import fc from 'fast-check'

// import { bn } from '../../common/numbers'
import { FixedCallerMock } from '../../typechain/FixedCallerMock'

// These tests are doing basically everything in bigint arithmetic, instead of ethers.BigNumber
// Much easier to work with fast-check this way -- but, frankly, just much easier to work this way!

enum RoundingMode {
  FLOOR,
  ROUND,
  CEIL,
}

// useful constants
const FLOOR = RoundingMode.FLOOR
const ROUND = RoundingMode.ROUND
const SCALE = 10n ** 18n
const UINTMIN = 0n - 2n ** 255n
const UINTMAX = 2n ** 256n

// handy bigint arithmatic functions...

const abs = (x: bigint) => (x >= 0 ? x : -x)

const ceilDiv = (x: bigint, y: bigint) => (x >= 0 ? (x + abs(y) - 1n) / y : (x - abs(y) + 1n) / y)
const roundDiv = (x: bigint, y: bigint) => (x >= 0 ? (x + abs(y) / 2n) / y : (x - abs(y) / 2n) / y)
const div = (x: bigint, y: bigint, r: RoundingMode) =>
  r == FLOOR ? x / y : r == ROUND ? roundDiv(x, y) : ceilDiv(x, y)

// n * d ** 10n, only maybe d is negative
const pow10 = (n: bigint, d: bigint, r: RoundingMode) =>
  d > 0 ? n * 10n ** d : div(n, 10n ** -d, r)

// shorthand arbitraries
// arbInt: if N is positive, an arbitrary uint<n> value; if N is negative, an arbitrary int<-n> value
const arbInt = (n: number) => (n > 0 ? fc.bigUintN(n) : fc.bigIntN(-n))
const arbRnd = fc.integer({ min: 0, max: 2 })

// fc.configureGlobal({
//   interruptAfterTimeLimit: 20000,
//   markInterruptAsFailure: false,
//   numRuns: 1000,
// })

/* Reusable fc.assert statements for these pure-math functions, in bigint.
   (I'm sure there's some way in Typescript to state all of these as a single implementation -- but
   while that reduce repetition, I hardly expect that to be _easier to read_ overall)
*/

async function unaryOp(
  sizes: [number, number],
  solFn: (x: BigNumberish) => Promise<BigNumber>,
  mathFn: (x: bigint) => bigint,
  skipFn: undefined | null | ((x: bigint) => boolean)
) {
  await fc.assert(
    fc.asyncProperty(arbInt(sizes[0]), async (x) => {
      if (skipFn && skipFn(x)) return
      const expected: bigint = mathFn(x)
      if (0 <= expected && expected < 2n ** BigInt(sizes[1])) {
        const value = await solFn(x)
        expect(value).to.equal(expected)
      } else {
        await expect(solFn(x)).to.be.reverted
      }
    })
  )
}

async function unaryRndOp(
  sizes: [number, number],
  solFn: (x: BigNumberish, r: RoundingMode) => Promise<BigNumber>,
  mathFn: (x: bigint, r: RoundingMode) => bigint,
  skipFn: undefined | null | ((x: bigint, r: RoundingMode) => boolean)
) {
  await fc.assert(
    fc.asyncProperty(arbInt(sizes[0]), arbRnd, async (x, r) => {
      if (skipFn && skipFn(x, r)) return
      const expected: bigint = mathFn(x, r)
      if (0 <= expected && expected < 2n ** BigInt(sizes[1])) {
        const value = await solFn(x, r)
        expect(value).to.equal(expected)
      } else {
        await expect(solFn(x, r)).to.be.reverted
      }
    })
  )
}

async function binaryOp(
  sizes: [number, number, number],
  solFn: (x: BigNumberish, y: BigNumberish) => Promise<BigNumber>,
  mathFn: (x: bigint, y: bigint) => bigint,
  skipFn: undefined | null | ((x: bigint, y: bigint) => boolean)
) {
  await fc.assert(
    fc.asyncProperty(arbInt(sizes[0]), arbInt(sizes[1]), async (x, y) => {
      if (skipFn && skipFn(x, y)) return
      const expected: bigint = mathFn(x, y)
      if (0 <= expected && expected < 2n ** BigInt(sizes[2])) {
        const value = await solFn(x, y)
        expect(value).to.equal(expected)
      } else {
        await expect(solFn(x, y)).to.be.reverted
      }
    })
  )
}

async function binaryRndOp(
  sizes: [number, number, number],
  solFn: (x: BigNumberish, y: BigNumberish, r: RoundingMode) => Promise<BigNumber>,
  mathFn: (x: bigint, y: bigint, r: RoundingMode) => bigint,
  skipFn: undefined | null | ((x: bigint, y: bigint, r: RoundingMode) => boolean)
) {
  await fc.assert(
    fc.asyncProperty(arbInt(sizes[0]), arbInt(sizes[1]), arbRnd, async (x, y, r) => {
      if (skipFn && skipFn(x, y, r)) return
      const expected: bigint = mathFn(x, y, r)
      if (0 <= expected && expected < 2n ** BigInt(sizes[2])) {
        const value = await solFn(x, y, r)
        expect(value).to.equal(expected)
      } else {
        await expect(solFn(x, y, r)).to.be.reverted
      }
    })
  )
}

async function ternaryOp(
  sizes: [number, number, number, number],
  solFn: (x: BigNumberish, y: BigNumberish, z: BigNumberish) => Promise<BigNumber>,
  mathFn: (x: bigint, y: bigint, z: bigint) => bigint,
  skipFn: undefined | null | ((x: bigint, y: bigint, z: bigint) => boolean)
) {
  await fc.assert(
    fc.asyncProperty(arbInt(sizes[0]), arbInt(sizes[1]), arbInt(sizes[2]), async (x, y, z) => {
      if (skipFn && skipFn(x, y, z)) return
      const expected: bigint = mathFn(x, y, z)
      if (0 <= expected && expected < 2n ** BigInt(sizes[3])) {
        const value = await solFn(x, y, z)
        expect(value).to.equal(expected)
      } else {
        await expect(solFn(x, y, z)).to.be.reverted
      }
    })
  )
}

async function ternaryRndOp(
  sizes: [number, number, number, number],
  solFn: (x: BigNumberish, y: BigNumberish, z: BigNumberish, r: RoundingMode) => Promise<BigNumber>,
  mathFn: (x: bigint, y: bigint, z: bigint, r: RoundingMode) => bigint,
  skipFn: undefined | null | ((x: bigint, y: bigint, z: bigint, r: RoundingMode) => boolean)
) {
  await fc.assert(
    fc.asyncProperty(
      arbInt(sizes[0]),
      arbInt(sizes[1]),
      arbInt(sizes[2]),
      arbRnd,
      async (x, y, z, r) => {
        if (skipFn && skipFn(x, y, z, r)) return
        const expected: bigint = mathFn(x, y, z, r)
        if (0 <= expected && expected < 2n ** BigInt(sizes[3])) {
          const value = await solFn(x, y, z, r)
          expect(value).to.equal(expected)
        } else {
          await expect(solFn(x, y, z, r)).to.be.reverted
        }
      }
    )
  )
}

describe('FixLib Fuzzing', () => {
  let caller: FixedCallerMock

  before(async () => {
    const FixedCaller = await ethers.getContractFactory('FixedCallerMock')
    caller = await (<Promise<FixedCallerMock>>FixedCaller.deploy())
  })

  it('toFix(uint256)', async () => {
    await unaryOp([256, 192], caller.toFix_, (x) => x * SCALE, null)
  })

  it('shiftl_toFix(uint256, int8)', async () => {
    await binaryOp([192, -8, 192], caller.shiftl_toFix_, (x, d) => pow10(x, d + 18n, FLOOR), null)
  })
  it('shiftl_toFix(uint256, int8, rnd)', async () => {
    await binaryRndOp(
      [192, -8, 192],
      caller.shiftl_toFix_Rnd,
      (x, d, r) => pow10(x, d + 18n, r),
      null
    )
  })
  it('divFix(uint256, uint192)', async () => {
    await binaryOp(
      [256, 192, 192],
      caller.divFix_,
      (x, y) => (x * SCALE * SCALE) / y,
      (x, y) => y == 0n
    )
  })
  it('divuu(uint256, uint256)', async () => {
    await binaryOp(
      [256, 256, 192],
      caller.divuu_,
      (x, y) => (x * SCALE) / y,
      (x, y) => y == 0n
    )
  })
  it('abs(int256)', async () => {
    await unaryOp(
      [-256, 256],
      caller.abs_,
      (x) => abs(x),
      (x) => x == UINTMIN
    )
  })
  it('_divrnd(uint256, uint256, rnd)', async () => {
    await binaryRndOp(
      [256, 256, 256],
      caller.divrnd_,
      (x, y, r) => div(x, y, r),
      (x, y) => y == 0n
    )
  })
  it('toUint(uint192)', async () => {
    await unaryOp([192, 256], caller.toUint, (x) => x / SCALE, null)
  })
  it('toUint(uint192, RoundingMode rounding)', async () => {
    await unaryRndOp([192, 256], caller.toUintRnd, (x, r) => div(x, SCALE, r), null)
  })
  it('shiftl(uint192, int8 decimals)', async () => {
    await binaryOp([192, -8, 192], caller.shiftl, (x, d) => pow10(x, d, FLOOR), null)
  })
  it('shiftl(uint192, int8 decimals, RoundingMode rounding)', async () => {
    await binaryRndOp([192, -8, 192], caller.shiftlRnd, (x, d, r) => pow10(x, d, r), null)
  })
  it('plus(uint192, uint192)', async () => {
    await binaryOp([192, 192, 192], caller.plus, (x, y) => x + y, null)
  })
  it('plusu(uint192, uint256)', async () => {
    await binaryOp([192, 256, 192], caller.plusu, (x, y) => x + y * SCALE, null)
  })
  it('minus(uint192, uint192)', async () => {
    await binaryOp([192, 192, 192], caller.minus, (x, y) => x - y, null)
  })
  it('minusu(uint192, uint256)', async () => {
    await binaryOp([192, 192, 192], caller.minusu, (x, y) => x - y * SCALE, null)
  })
  it('mul(uint192, uint192)', async () => {
    await binaryOp(
      [192, 192, 192],
      caller.mul,
      (x, y) => div(x * y, SCALE, RoundingMode.ROUND),
      null
    )
  })
  it('mul(uint192, uint192, RoundingMode rounding)', async () => {
    await binaryRndOp([192, 192, 192], caller.mulRnd, (x, y, r) => div(x * y, SCALE, r), null)
  })
  it('mulu(uint192, uint256)', async () => {
    await binaryOp([192, 256, 192], caller.mulu, (x, y) => x * y, null)
  })
  it('div(uint192, uint192)', async () => {
    await binaryOp(
      [192, 192, 192],
      caller.div,
      (x, y) => (x * SCALE) / y,
      (x, y) => y == 0n
    )
  })
  it('div(uint192, uint192, RoundingMode rounding)', async () => {
    await binaryRndOp(
      [192, 192, 192],
      caller.divRnd,
      (x, y, r) => div(x * SCALE, y, r),
      (x, y) => y == 0n
    )
  })
  it('divu(uint192, uint256)', async () => {
    await binaryOp(
      [192, 256, 192],
      caller.divu,
      (x, y) => x / y,
      (x, y) => y == 0n
    )
  })
  it('divu(uint192, uint256, RoundingMode rounding)', async () => {
    await binaryRndOp(
      [192, 256, 192],
      caller.divuRnd,
      (x, y, r) => div(x, y, r),
      (x, y) => y == 0n
    )
  })

  it('shiftl_toUint(uint192, int8 decimals)', async () => {
    await binaryOp([192, -8, 256], caller.shiftl_toUint, (x, d) => pow10(x, d - 18n, FLOOR), null)
  })
  it('shiftl_toUint(uint192, int8 decimals, RoundingMode rounding)', async () => {
    await binaryRndOp(
      [192, -8, 256],
      caller.shiftl_toUintRnd,
      (x, d, r) => pow10(x, d - 18n, r),
      null
    )
  })
  it('mulu_toUint(uint192, uint256)', async () => {
    await binaryOp([192, 256, 256], caller.mulu_toUint, (x, y) => (x * y) / SCALE, null)
  })
  it('mulu_toUint(uint192, uint256, RoundingMode rounding)', async () => {
    await binaryRndOp(
      [192, 256, 256],
      caller.mulu_toUintRnd,
      (x, y, r) => div(x * y, SCALE, r),
      null
    )
  })
  it('mul_toUint(uint192, uint192)', async () => {
    await binaryOp([192, 192, 256], caller.mul_toUint, (x, y) => (x * y) / (SCALE * SCALE), null)
  })
  it('mul_toUint(uint192, uint192, RoundingMode rounding)', async () => {
    await binaryRndOp(
      [192, 192, 256],
      caller.mul_toUintRnd,
      (x, y, r) => div(x * y, SCALE * SCALE, r),
      null
    )
  })

  it('muluDivu(uint192, uint256, uint256)', async () => {
    await ternaryOp(
      [192, 256, 256, 192],
      caller.muluDivu,
      (x, y, z) => (x * y) / z,
      (x, y, z) => z == 0n
    )
  })

  it('muluDivu(uint192, uint256, uint256, rnd)', async () => {
    await ternaryRndOp(
      [192, 256, 256, 192],
      caller.muluDivuRnd,
      (x, y, z, r) => div(x * y, z, r),
      (x, y, z) => z == 0n
    )
  })

  it('mulDiv(uint192, uint192, uint192)', async () => {
    await ternaryOp(
      [192, 192, 192, 192],
      caller.mulDiv,
      (x, y, z) => (x * y) / z,
      (x, y, z) => z == 0n
    )
  })

  it('mulDiv(uint192, uint192, uint192 ,rnd)', async () => {
    await ternaryRndOp(
      [192, 192, 192, 192],
      caller.mulDivRnd,
      (x, y, z, r) => div(x * y, z, r),
      (x, y, z) => z == 0n
    )
  })

  it('mulDiv256(uint256, uint256, uint256, rnd)', async () => {
    await ternaryRndOp(
      [256, 256, 256, 256],
      caller.mulDiv256Rnd_,
      (x, y, z, r) => div(x * y, z, r),
      (x, y, z) => z == 0n
    )
  })

  it(`fullMul(uint256, uint256)`, async () => {
    await fc.assert(
      fc.asyncProperty(arbInt(256), arbInt(256), async (x, y) => {
        const loExpected = (x * y) % UINTMAX
        const hiExpected = (x * y) / UINTMAX
        const [hiResult, loResult] = await caller.fullMul_(BigNumber.from(x), BigNumber.from(y))
        expect(hiResult).to.equal(hiExpected)
        expect(loResult).to.equal(loExpected)
      })
    )
  })

  it('powu(uint192 x, uint48 y)', async () => {
    // We limit y <= 2^12, because larger values of y cause this test to hang!
    // We do two versions: arbitrary x, and x bound less than 1e18
    // The latter tends to locate more frequent true bugs, because overflow isn't
    // so immediate
    await fc.assert(
      fc.asyncProperty(fc.bigUint(10n ** 18n), arbInt(12), async (base, power) => {
        if (power == 0n) return
        const expected = div(base ** power, SCALE ** (power - 1n), ROUND)
        if (expected < 2n ** 192n) {
          const error = 1n
          const actual = (await caller.powu(base, power)).toBigInt()

          assert(
            actual >= expected - error,
            `Expected ${actual} to be within ${error} of ${expected}`
          )
          assert(
            actual <= expected + error,
            `Expected ${actual} to be within ${error} of ${expected}`
          )
        } else {
          await expect(caller.powu(base, power)).to.be.reverted
        }
      })
    )
  })

  it('shiftl_toFix regression', async () => {
    const actual = await caller.shiftl_toFix_Rnd(6n * 10n ** 76n, 0n - 95n, ROUND)
    expect(actual).to.equal(1n)
  })

  it('shiftl regression', async () => {
    const actual = await caller.shiftlRnd(5n * 10n ** 57n, 0n - 58n, ROUND)
    expect(actual).to.equal(1n)
  })
})
