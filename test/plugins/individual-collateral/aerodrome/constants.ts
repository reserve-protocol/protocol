import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'
import { useEnv } from '#/utils/env'

export const forkNetwork = useEnv('FORK_NETWORK') ?? 'base'

// Base Addresses
export const AERO_USDC_eUSD_GAUGE = '0x793F22aB88dC91793E5Ce6ADbd7E733B0BD4733e'
export const AERO_USDC_eUSD_POOL = '0x7A034374C89C463DD65D8C9BCfe63BcBCED41f4F'
export const AERO_USDC_eUSD_HOLDER = '0x5d823546463fD0Ac3b31DBA6AD38B56a39BFbf70' // for gauge

export const AERO_WETH_AERO_GAUGE = '0x96a24aB830D4ec8b1F6f04Ceac104F1A3b211a01'
export const AERO_WETH_AERO_POOL = '0x7f670f78B17dEC44d5Ef68a48740b6f8849cc2e6'
export const AERO_WETH_AERO_HOLDER = '0x9f2cB6b3A5BfE6A7D42c3702F628201616649C00' // for pool

export const AERO_MOG_WETH_GAUGE = '0x8FCc385d8d7f3A2e087853a79531630Bf96575e8'
export const AERO_MOG_WETH_POOL = '0x4a311ac4563abc30e71d0631c88a6232c1309ac5'
export const AERO_MOG_WETH_HOLDER = '0x76AbE28E4108eC1B56f429582087CFDdC757eAcc' // for pool

export const AERO_USDz_USDC_GAUGE = '0xb7E4bBee04285F4B55d0A93b34E5dA95C3a7faf9'
export const AERO_USDz_USDC_POOL = '0x6d0b9C9E92a3De30081563c3657B5258b3fFa38B'
export const AERO_USDz_USDC_HOLDER = '0x4C3cB0D6273A27C68AB4B2F96DB211d8d75e98Da'

export const AERO_WETH_cbBTC_GAUGE = '0xAFdEBa12B6a870d6639d043030b4b49F9C7c62BB'
export const AERO_WETH_cbBTC_POOL = '0x2578365B3dfA7FfE60108e181EFb79FeDdec2319'
export const AERO_WETH_cbBTC_HOLDER = '0x106b9121d259fb46F1033BDBd29ad0C67650953C'

export const AERO_WETH_WELL_GAUGE = '0x7b6964440b615aC1d31bc95681B133E112fB2684'
export const AERO_WETH_WELL_POOL = '0x89D0F320ac73dd7d9513FFC5bc58D1161452a657'
export const AERO_WETH_WELL_HOLDER = '0x5a6859C2f992B998837342d29911dD14E8DC2E1a'

export const AERO_WETH_DEGEN_GAUGE = '0x86A1260AB9f758026Ce1a5830BdfF66DBcF736d5'
export const AERO_WETH_DEGEN_POOL = '0x2C4909355b0C036840819484c3A882A95659aBf3'
export const AERO_WETH_DEGEN_HOLDER = '0xC314990f1379fEe384Be9a74328C75Df8587aE77'

export const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'

// Tokens
export const USDC = networkConfig['8453'].tokens.USDC!
export const WETH = networkConfig['8453'].tokens.WETH!
export const eUSD = networkConfig['8453'].tokens.eUSD!
export const USDz = networkConfig['8453'].tokens.USDz!
export const AERO = networkConfig['8453'].tokens.AERO!
export const MOG = networkConfig['8453'].tokens.MOG!
export const cbBTC = networkConfig['8453'].tokens.cbBTC!
export const WELL = networkConfig['8453'].tokens.WELL!
export const DEGEN = networkConfig['8453'].tokens.DEGEN!

// USDC
export const USDC_USD_FEED = networkConfig['8453'].chainlinkFeeds.USDC!
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.003')
export const USDC_HOLDER = '0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A'

// eUSD
export const eUSD_USD_FEED = networkConfig['8453'].chainlinkFeeds.eUSD!
export const eUSD_ORACLE_TIMEOUT = bn('86400')
export const eUSD_ORACLE_ERROR = fp('0.005')
export const eUSD_HOLDER = '0xb5E331615FdbA7DF49e05CdEACEb14Acdd5091c3'

// USDz
export const USDz_USD_FEED = networkConfig['8453'].chainlinkFeeds.USDz!
export const USDz_ORACLE_TIMEOUT = bn('86400')
export const USDz_ORACLE_ERROR = fp('0.005')
export const USDz_HOLDER = '0xA87c9808C0eBE20a1427B5C769623c77201f6f4D'

export const FORK_BLOCK = 22854038 //19980400

// AERO
export const AERO_ORACLE_ERROR = fp('0.005') // 0.5%
export const AERO_ORACLE_TIMEOUT = bn('86400') // 24hr
export const AERO_USD_FEED = networkConfig['8453'].chainlinkFeeds.AERO!
export const AERO_HOLDER = '0x807877258B55BfEfaBDD469dA1C72731C5070839'

// ETH
export const ETH_ORACLE_ERROR = fp('0.0015') // 0.15%
export const ETH_ORACLE_TIMEOUT = bn('1200') // 20min
export const ETH_USD_FEED = networkConfig['8453'].chainlinkFeeds.ETHUSD!
export const WETH_HOLDER = '0x6446021F4E396dA3df4235C62537431372195D38'

// MOG
export const MOG_ORACLE_ERROR = fp('0.005') // 0.5%
export const MOG_ORACLE_TIMEOUT = bn('86400') // 24hr
export const MOG_USD_FEED = networkConfig['8453'].chainlinkFeeds.MOG!
export const MOG_HOLDER = '0xBaeD383EDE0e5d9d72430661f3285DAa77E9439F'

// cbBTC
export const cbBTC_ORACLE_ERROR = fp('0.003') // 0.3%
export const cbBTC_ORACLE_TIMEOUT = bn('1200') // 20 min
export const cbBTC_USD_FEED = networkConfig['8453'].chainlinkFeeds.cbBTC!
export const cbBTC_HOLDER = '0xF877ACaFA28c19b96727966690b2f44d35aD5976'

// WELL
export const WELL_ORACLE_ERROR = fp('0.005') // 0.5%
export const WELL_ORACLE_TIMEOUT = bn('86400') // 24hr
export const WELL_USD_FEED = networkConfig['8453'].chainlinkFeeds.WELL!
export const WELL_HOLDER = '0xe66E3A37C3274Ac24FE8590f7D84A2427194DC17'

// DEGEN
export const DEGEN_ORACLE_ERROR = fp('0.005') // 0.5%
export const DEGEN_ORACLE_TIMEOUT = bn('86400') // 24hr
export const DEGEN_USD_FEED = networkConfig['8453'].chainlinkFeeds.DEGEN!
export const DEGEN_HOLDER = '0x06A19654e0872Ba71c2261EA691Ecf8a0c677156'

// Common
export const FIX_ONE = 1n * 10n ** 18n
export const ORACLE_ERROR = fp('0.005')
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const DEFAULT_THRESHOLD = fp('0.02') // 2%
export const DELAY_UNTIL_DEFAULT = bn('259200') // 72h CAREFUL THIS IS ONLY FOR RTOKEN POOLS
export const MAX_TRADE_VOL = fp('1e6')

export enum AerodromePoolType {
  Stable,
  Volatile,
}
