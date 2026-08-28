import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'
import { useEnv } from '#/utils/env'

export const forkNetwork = useEnv('FORK_NETWORK') ?? 'mainnet'
let chainId

switch (forkNetwork) {
  case 'mainnet':
    chainId = '1'
    break
  case 'base':
    chainId = '8453'
    break
  case 'arbitrum':
    chainId = '42161'
    break
  default:
    chainId = '1'
    break
}

// Addresses

export const STEAKUSDC = networkConfig[chainId].tokens.steakUSDC!
export const STEAKPYUSD = networkConfig[chainId].tokens.steakPYUSD!
export const BBUSDT = networkConfig[chainId].tokens.bbUSDT!
export const RE7WETH = networkConfig[chainId].tokens.Re7WETH!
export const MEUSD = networkConfig[chainId].tokens.meUSD!

// Morpho Vault V2 (mainnet)
export const STEAKUSDC_PRIME = networkConfig[chainId].tokens.steakUSDCPrime!
export const SENTORA_PYUSD = networkConfig[chainId].tokens.sentoraPYUSD!
export const GAUNTLET_USDC_FRONTIER = networkConfig[chainId].tokens.gauntletUSDCFrontier!
export const STEAKUSDT_PRIME = networkConfig[chainId].tokens.steakUSDTPrime!
export const GALAXY_USDT_QUALITY = networkConfig[chainId].tokens.galaxyUSDTQuality!
export const GAUNTLET_USDC_PRIME = networkConfig[chainId].tokens.gauntletUSDCPrime!
export const GALAXY_USDC_QUALITY = networkConfig[chainId].tokens.galaxyUSDCQuality!
export const SKY_USDT_SAVINGS = networkConfig[chainId].tokens.skyUSDTSavings!

// USDC
export const USDC_USD_FEED = networkConfig[chainId].chainlinkFeeds.USDC!
export const USDC_ORACLE_TIMEOUT = bn('82800') // 23 hrs
export const USDC_ORACLE_ERROR = fp('0.0025')

// PYUSD
export const PYUSD_USD_FEED = networkConfig[chainId].chainlinkFeeds.pyUSD!
export const PYUSD_ORACLE_TIMEOUT = bn('86400')
export const PYUSD_ORACLE_ERROR = fp('0.003')

// USDT
export const USDT_USD_FEED = networkConfig[chainId].chainlinkFeeds.USDT!
export const USDT_ORACLE_TIMEOUT = bn('86400')
export const USDT_ORACLE_ERROR = fp('0.0025')

// ETH
export const ETH_USD_FEED = networkConfig[chainId].chainlinkFeeds.ETH!
export const ETH_ORACLE_TIMEOUT = bn('3600')
export const ETH_ORACLE_ERROR = fp('0.005')

// eUSD
export const eUSD_USD_FEED = networkConfig[chainId].chainlinkFeeds.eUSD!
export const eUSD_ORACLE_TIMEOUT = bn('86400')
export const eUSD_ORACLE_ERROR = fp('0.005')

//  General
export const PRICE_TIMEOUT = bn(604800) // 1 week
export const DELAY_UNTIL_DEFAULT = bn(86400)

const FORK_BLOCKS: { [key: string]: number } = {
  '1': 19463181,
  '8453': 20454200,
  '42161': 193157126, // not used
}

export const FORK_BLOCK = FORK_BLOCKS[chainId]

// Morpho Vault V2 vaults post-date the V1 mainnet block above; keyed by network for consistency
const FORK_BLOCKS_V2: { [key: string]: number } = {
  '1': 25250000,
  '8453': 20454200, // no V2 vaults integrated yet
  '42161': 193157126, // not used
}

export const FORK_BLOCK_V2 = FORK_BLOCKS_V2[chainId]

// ============================ MORPHO reward-token Asset ============================
// MORPHO is the reward token earned by holding the MetaMorpho / Morpho Vault V2 collateral
// above. `MorphoAsset` exists so it can be sold as revenue; it is never used as backing.
// Mainnet-only: the MORPHO/WETH Uniswap V3 pools are mainnet-only, and no {UoA} feed for
// MORPHO exists there (Chainlink's MORPHO/USD is Base-only), hence the TWAP. The suite skips
// unless FORK_NETWORK=mainnet.
// Reuses ETH_USD_FEED, ETH_ORACLE_TIMEOUT and PRICE_TIMEOUT from above.

// The new, transferable MORPHO. The legacy 0x9994E35D... is a different ERC20 and is NOT
// what rewards are paid in; see LEGACY_MORPHO in the morpho-aave constants.
export const MORPHO = '0x58D97B57BB95320F9a05dC918Aef65434969c2B2'

export const WETH = networkConfig[chainId].tokens.WETH!
export const USDC = networkConfig[chainId].tokens.USDC!
// Lower-address token than MORPHO, used to exercise the inverse quote branch in tests
export const WBTC = networkConfig[chainId].tokens.WBTC!

// Uniswap V3 MORPHO/WETH pools; both hold MORPHO as token0.
// The 0.30% pool is the deeper of the two and is the intended production source.
export const MORPHO_WETH_POOL_030 = '0xc8219b876753A85025156b22176c2eDEA17aAC53'
export const MORPHO_WETH_POOL_100 = '0x25b96761e765b9AC20db18fA57Fa91e3b617Ec6F'

// Wider than a normal ETH/USD error: it also absorbs TWAP-vs-spot drift on a thin pool
export const MORPHO_ORACLE_ERROR = fp('0.05') // 5%

// Deliberately far below the usual $1e6. All mainnet MORPHO liquidity is ~$126k, and the deepest
// priceable venue (the 0.30% pool) holds ~$62k of MORPHO against ~$95-122k of WETH. Since a
// manipulated-downwards TWAP lowers the DutchTrade floor, per-auction exposure -- not the oracle
// -- is the binding protection. Revisit if liquidity deepens.
export const MORPHO_MAX_TRADE_VOLUME = fp('1e4') // $10k

// {s} TWAP window. Longer is more manipulation-resistant; the pool must retain this much history.
export const MORPHO_TWAP_WINDOW = 1800 // 30 min

// The MORPHO/WETH pools post-date the blocks above
export const MORPHO_ASSET_FORK_BLOCK = 25832080

// Expected MORPHO price at MORPHO_ASSET_FORK_BLOCK, from the 0.30% pool's 30-min TWAP x ETH/USD.
// ETH/USD = $2479.93, TWAP = 0.00107240 WETH/MORPHO
export const MORPHO_USD_AT_FORK_BLOCK = fp('2.6592')
