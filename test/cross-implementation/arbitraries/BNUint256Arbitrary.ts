import fc from 'fast-check'
import { BigNumber } from 'ethers'
import { MAX_UINT256 } from '../../../common/constants'

export const bnUint256 = () =>
  fc
    .bigUintN(256)
    .map((amt) => BigNumber.from(amt))
    .filter((bn) => bn.lte(MAX_UINT256))
