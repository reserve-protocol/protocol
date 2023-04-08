import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const DAI_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.DAI as string
export const USDC_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDC as string
export const RETH = networkConfig['31337'].tokens.rETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const DAI = networkConfig['31337'].tokens.DAI as string
export const USDC = networkConfig['31337'].tokens.USDC as string
export const FRAX = networkConfig['31337'].tokens.FRAX as string
export const dDAI = networkConfig['31337'].tokens.dDAI as string
export const dUSDC = networkConfig['31337'].tokens.dUSDC as string
export const dFRAX = networkConfig['31337'].tokens.dFRAX as string
export const dWETH = networkConfig['31337'].tokens.dWETH as string

export const GEARBOX_WETH_POOL_SERVICE = '0xB03670c20F87f2169A7c4eBE35746007e9575901'
export const GEARBOX_DAI_POOL_SERVICE = '0x24946bCbBd028D5ABb62ad9B635EB1b1a67AF668'
export const GEARBOX_USDC_POOL_SERVICE = '0x86130bDD69143D8a4E5fc50bf4323D48049E98E4'
export const GEARBOX_FRAX_POOL_SERVICE = '0x79012c8d491dcf3a30db20d1f449b14caf01da6c'

export const DDAI_WHALE = '0x9E406B2c2021966f3983E899643609C45E3bBFFe'

export const WETH_WHALE = '0x741AA7CFB2c7bF2A1E7D4dA2e3Df6a56cA4131F3'
export const DAI_WHALE = '0x25B313158Ce11080524DcA0fD01141EeD5f94b81'
export const USDC_WHALE = '0x07A4dfA9Ffff1FF137A62809BFaF990DC9aa674a'
export const FRAX_WHALE = '0x13Cc34Aa8037f722405285AD2C82FE570bfa2bdc'

export const BIG_LOANER = 'A'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 17002291
