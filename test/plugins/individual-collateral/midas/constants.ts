import { bn, fp } from '../../../../common/numbers'

export const FORK_BLOCK = 21360000
export const REVENUE_HIDING = fp('0.01') // 10 bps = 0.0001
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(172800) // 48 hours
export const MAX_TRADE_VOL = bn(1000)

export const PRICE_TIMEOUT = bn(604800) // 1 week
export const CHAINLINK_ORACLE_TIMEOUT = bn(86400) // 24 hours
export const MIDAS_ORACLE_TIMEOUT = bn(2592000) // 30 days
export const ORACLE_TIMEOUT_BUFFER = bn(300) // 5 min
export const ORACLE_ERROR = fp('0.005')

export const BTC_FEED_DEFAULT_ANSWER = bn('100000e8') // 1 BTC = 100,000 USD
export const MBTC_FEED_DEFAULT_ANSWER = bn('1e8') // 1 mBTC = 1 BTC

export const USDC_FEED_DEFAULT_ANSWER = bn('1e8') // 1 USDC = 1 USD
export const MTBILL_FEED_DEFAULT_ANSWER = bn('1e8') // 1 mTBILL = 1 USDC

export const midasContracts = {
  /** Midas Tokens */
  // Fiat Collateral
  mTBILL: '0xDD629E5241CbC5919847783e6C96B2De4754e438',
  mtbillDataFeed: '0xfCEE9754E8C375e145303b7cE7BEca3201734A2B',
  mtbillAggregator: '0x056339C044055819E8Db84E71f5f2E1F536b2E5b',

  mBASIS: '0x2a8c22E3b10036f3AEF5875d04f8441d4188b656',
  mbasisDataFeed: '0x1615cBC603192ae8A9FF20E98dd0e40a405d76e4',
  mbasisAggregator: '0xE4f2AE539442e1D3Fb40F03ceEbF4A372a390d24',

  // Non Fiat Collateral
  mBTC: '0x007115416AB6c266329a03B09a8aa39aC2eF7d9d',
  mbtcDataFeed: '0x9987BE0c1dc5Cd284a4D766f4B5feB4F3cb3E28e',
  mbtcAggregator: '0xA537EF0343e83761ED42B8E017a1e495c9a189Ee',

  chainlinkFeeds: {
    BTC: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  },
}
