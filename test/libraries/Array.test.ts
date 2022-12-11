import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import fc from 'fast-check'

import { ArrayCallerMock } from '../../typechain/ArrayCallerMock'

function addr(n: bigint): string {
  return ethers.utils.hexZeroPad(BigNumber.from(n).toHexString(), 20)
}

const arbitraryAddrNums = fc.array(fc.bigUintN(160))

const arbitraryAddressArray = fc.array(fc.bigUintN(160)).map((arr) => arr.map(addr))

const is_unique = (arr: Array<bigint | string>) => new Set(arr).size === arr.length

const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)

function is_sorted(nums: bigint[]) {
  const numsSorted: bigint[] = Array.from(nums).sort(compare)
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] != numsSorted[i]) return false
  }
  return true
}

describe('In ArrayLib,', () => {
  let caller: ArrayCallerMock

  before(async () => {
    const ArrayCaller = await ethers.getContractFactory('ArrayCallerMock')
    caller = await (<Promise<ArrayCallerMock>>ArrayCaller.deploy())
  })

  it('allUnique on random inputs', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAddressArray, async (arr) => {
        const expected = is_unique(arr)
        const actual = await caller.allUnique(arr)
        expect(actual).to.equal(expected)
      })
    )
  })

  it('allUnique on non-unique inputs', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAddressArray, fc.nat(), fc.nat(), async (arr, a, b) => {
        if (arr.length == 0) return
        const srcIndex = a % arr.length
        const dstIndex = ((b % (arr.length - 1)) + srcIndex + 1) % arr.length
        arr.splice(dstIndex, 0, arr[srcIndex])

        const expected = is_unique(arr)
        const actual = await caller.allUnique(arr)
        expect(actual).to.equal(expected)
      })
    )
  })

  it('sortedAndAllUnique on random inputs', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAddrNums, async (nums) => {
        const addrs = nums.map(addr)
        const expected = is_unique(addrs) && is_sorted(nums)
        const actual = await caller.sortedAndAllUnique(addrs)
        expect(actual).to.equal(expected)
      })
    )
  })

  it('sortedAndAllUnique on non-unique inputs', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAddrNums, fc.nat(), fc.nat(), async (nums, a, b) => {
        if (nums.length == 0) return
        const srcIndex = a % nums.length
        const dstIndex = ((b % (nums.length - 1)) + srcIndex + 1) % nums.length
        nums.splice(dstIndex, 0, nums[srcIndex])
        const addrs = nums.map(addr)

        const expected = is_unique(addrs) && is_sorted(nums)
        const actual = await caller.sortedAndAllUnique(addrs)
        expect(actual).to.equal(expected)
      })
    )
  })

  it('sortedAndAllUnique on sorted inputs', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAddrNums, async (nums) => {
        nums.sort(compare)
        const addrs = nums.map(addr)
        const expected = is_unique(addrs)
        const actual = await caller.sortedAndAllUnique(addrs)
        expect(actual).to.equal(expected)
      })
    )
  })
})
