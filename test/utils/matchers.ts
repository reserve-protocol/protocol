import { BigNumber } from 'ethers'
import { bn } from '../../common/numbers'

// Creates a chai matcher that returns true if y is within a quadrillion of x
export const withinQuad = (x: BigNumber): ((y: BigNumber) => boolean) => {
  return (y: BigNumber) => {
    const tolerance = x.div(bn('1e15'))
    const lower = x.sub(tolerance)
    const higher = x.add(tolerance)
    return y.gte(lower) && y.lte(higher)
  }
}
