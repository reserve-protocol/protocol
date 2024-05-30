import { utils, BigNumber } from 'ethers'

export const ZERO_BYTES = '0x0000000000000000000000000000000000000000000000000000000000000000'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ONE_ADDRESS = '0x0000000000000000000000000000000000000001'

export const ONE_ETH = BigNumber.from('1000000000000000000')

export const ONE_PERIOD = BigNumber.from('1')

export const ONE_DAY = BigNumber.from('86400')

export const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1)
export const MAX_UINT192 = BigNumber.from(2).pow(192).sub(1)
export const MAX_UINT96 = BigNumber.from(2).pow(96).sub(1)
export const MAX_UINT48 = BigNumber.from(2).pow(48).sub(1)
export const MAX_UINT32 = 2 ** 32 - 1
export const MAX_UINT16 = 2 ** 16 - 1

export const SCALE_DECIMALS = 18
export const SCALE_FACTOR = 10 ** SCALE_DECIMALS
export const BN_SCALE_FACTOR = BigNumber.from(SCALE_FACTOR.toString())

// @dev Must match `IAsset.CollateralStatus`.
export enum CollateralStatus {
  SOUND,
  IFFY,
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

// @dev Must match `ITrade.TradeStatus`.
export enum TradeStatus {
  NOT_STARTED,
  OPEN,
  CLOSED,
}

export enum TradeKind {
  DUTCH_AUCTION,
  BATCH_AUCTION,
}

export enum BidType {
  NONE,
  CALLBACK,
  TRANSFER,
}

export const FURNACE_DEST = '0x0000000000000000000000000000000000000001'
export const STRSR_DEST = '0x0000000000000000000000000000000000000002'

export const QUEUE_START = '0x0000000000000000000000000000000000000000000000000000000000000001'

// Auth roles
export const OWNER = utils.formatBytes32String('OWNER')
export const SHORT_FREEZER = utils.formatBytes32String('SHORT_FREEZER')
export const LONG_FREEZER = utils.formatBytes32String('LONG_FREEZER')
export const PAUSER = utils.formatBytes32String('PAUSER')
