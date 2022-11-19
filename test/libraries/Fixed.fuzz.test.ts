import { expect } from 'chai'
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

// const FLOOR = RoundingMode.FLOOR
// const ROUND = RoundingMode.ROUND
// const CEIL = RoundingMode.CEIL

const SCALE = 10n ** 18n

const abs = (x: bigint) => (x >= 0 ? x : -x)
const ceilDiv = (x: bigint, y: bigint) => (x >= 0 ? (x + abs(y) - 1n) / y : (x - abs(y) + 1n) / y)
const roundDiv = (x: bigint, y: bigint) => (x >= 0 ? (x + abs(y) / 2n) / y : (x - abs(y) / 2n) / y)

const div = (x: bigint, y: bigint, r: RoundingMode) =>
  r == FLOOR ? x / y : r == ROUND ? roundDiv(x, y) : ceilDiv(x, y)

// If N is positive, an arbitrary uint<n> value
// If N is negative, an arbitrary int<-n> value
const arbInt = (n: number) => (n > 0 ? fc.bigUintN(n) : fc.bigIntN(-n))
const arbRnd = fc.integer({ min: 0, max: 2 })

const UINTMAX = 2n ** 256n

// fc.configureGlobal({
// interruptAfterTimeLimit: 5000,
// markInterruptAsFailure: false,
// numRuns: 200,
// })

async function unaryUintProperty(
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

async function unaryUintPropertyWithRounding(
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

async function binaryUintProperty(
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

async function binaryUintPropertyWithRounding(
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

async function ternaryUintProperty(
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

async function ternaryUintPropertyWithRounding(
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

  it('toFix(uint)', async () => {
    await unaryUintProperty([256, 192], caller.toFix_, (x) => x * SCALE, null)
  })

  it('muluDivu(,,)', async () => {
    await ternaryUintProperty(
      [192, 256, 256, 192],
      caller.muluDivu,
      (x, y, z) => (x * y) / z,
      (x, y, z) => z == 0n
    )
  })

  it('muluDivu(,,rnd)', async () => {
    await ternaryUintPropertyWithRounding(
      [192, 256, 256, 192],
      caller.muluDivuRnd,
      (x, y, z, r) => div(x * y, z, r),
      (x, y, z, r) => z == 0n
    )
  })

  it('mulDiv(,,rnd)', async () => {
    await ternaryUintPropertyWithRounding(
      [192, 192, 192, 192],
      caller.mulDivRnd,
      (x, y, z, r) => div(x * y, z, r),
      (x, y, z, r) => z == 0n
    )
  })

  it('mulDiv256(,,rnd)', async () => {
    await ternaryUintPropertyWithRounding(
      [256, 256, 256, 256],
      caller.mulDiv256Rnd_,
      (x, y, z, r) => div(x * y, z, r),
      (x, y, z, r) => z == 0n
    )
  })

  it(`fullMul(,)`, async () => {
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
})
