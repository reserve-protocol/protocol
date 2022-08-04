import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ONE_ADDRESS = '0x0000000000000000000000000000000000000001'

export const ONE_ETH = BigNumber.from('1000000000000000000')

export const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1)
export const MAX_UINT32 = 2 ** 32 - 1
export const MAX_UINT16 = 2 ** 16 - 1

export const SCALE_DECIMALS = 18
export const SCALE_FACTOR = 10 ** SCALE_DECIMALS
export const BN_SCALE_FACTOR = BigNumber.from(SCALE_FACTOR.toString())

// @dev Must match `IAsset.CollateralStatus`.
export enum CollateralStatus {
  SOUND,
  IFFY,
  UNPRICED,
  DISABLED,
}

// @dev Must match `Governance.ProposalState`.
export enum ProposalState {
  Pending,
  Active,
  Canceled,
  Defeated,
  Succeeded,
  Queued,
  Expired,
  Executed,
}

// @dev Must match `Fixed.RoundingApproach`.
export enum RoundingMode {
  FLOOR,
  ROUND,
  CEIL,
}

// @dev Must match `GnosisTrade.TradeStatus`.
export enum TradeStatus {
  NOT_STARTED,
  OPEN,
  CLOSED,
}

export const FURNACE_DEST = '0x0000000000000000000000000000000000000001'
export const STRSR_DEST = '0x0000000000000000000000000000000000000002'

export const QUEUE_START = '0x0000000000000000000000000000000000000000000000000000000000000001'

// Auth roles
export const OWNER = ethers.utils.formatBytes32String('OWNER')
export const FREEZE_STARTER = ethers.utils.formatBytes32String('FREEZE_STARTER')
export const FREEZE_EXTENDER = ethers.utils.formatBytes32String('FREEZE_EXTENDER')
export const PAUSER = ethers.utils.formatBytes32String('PAUSER')
