import { BigNumber } from 'ethers'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const ONE_ETH = BigNumber.from('1000000000000000000')

export const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1)
export const MAX_UINT16 = 2 ** 16 - 1

export const SCALE_DECIMALS = 18
export const SCALE_FACTOR = 10 ** SCALE_DECIMALS
export const BN_SCALE_FACTOR = BigNumber.from(SCALE_FACTOR.toString())
