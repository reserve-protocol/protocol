import { BigNumber } from 'ethers'
import { expect } from 'chai'
import { bn } from '../../common/numbers'

// Creates a chai matcher that returns true if y is within a quadrillion of x
export const withinTolerance = (x: BigNumber): ((y: BigNumber) => boolean) => {
  return (y: BigNumber) => {
    const tolerance = x.div(bn('1e13'))
    const lower = x.sub(tolerance)
    const higher = x.add(tolerance)
    return y.gte(lower) && y.lte(higher)
  }
}

export const expectEqualArrays = (arr1: Array<unknown>, arr2: Array<unknown>) => {
  expect(arr1.length).equal(arr2.length)
  for (let i = 0; i < arr1.length; i++) {
    expect(arr1[i]).equal(arr2[i])
  }
}
