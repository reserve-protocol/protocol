import { BigNumber, BigNumberish } from 'ethers'
import { fp, pow10 } from './numbers'

interface ICurrencies {
  ETH?: string
  BTC?: string
  EUR?: string
}

export interface ITokens {
  DAI?: string
  USDC?: string
  USDT?: string
  USDP?: string
  TUSD?: string
  BUSD?: string
  aDAI?: string
  aUSDC?: string
  aUSDT?: string
  aBUSD?: string
  aWETH?: string
  cDAI?: string
  cUSDC?: string
  cUSDT?: string
  cETH?: string
  cWBTC?: string
  AAVE?: string
  stkAAVE?: string
  COMP?: string
  WETH?: string
  WBTC?: string
  EURT?: string
  RSR?: string
}

interface INetworkConfig {
  name: string
  tokens: ITokens
  chainlinkFeeds: ITokens & ICurrencies
  AAVE_LENDING_POOL?: string
  AAVE_INCENTIVES?: string
  AAVE_EMISSIONS_MGR?: string
  COMPTROLLER?: string
  GNOSIS_EASY_AUCTION?: string
  EASY_AUCTION_OWNER?: string
}

export const networkConfig: { [key: string]: INetworkConfig } = {
  default: {
    name: 'hardhat',
    tokens: {},
    chainlinkFeeds: {},
  },
  // Config used for Mainnet forking -- Mirrors mainnet
  '31337': {
    name: 'localhost',
    tokens: {
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      BUSD: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
      USDP: '0x8E870D67F660D95d5be530380D0eC0bd388289E1',
      TUSD: '0x0000000000085d4780B73119b644AE5ecd22b376',
      aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      aUSDC: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      aBUSD: '0xA361718326c15715591c299427c62086F69923D9',
      aWETH: '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
      cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      cUSDT: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
      cETH: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
      cWBTC: '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4',
      AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      stkAAVE: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
      COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      EURT: '0xC581b735A1688071A1746c968e0798D642EDE491',
      RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
    },
    chainlinkFeeds: {
      RSR: '0x759bBC1be8F90eE6457C44abc7d443842a976d02',
      AAVE: '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
      COMP: '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5',
      DAI: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
      USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      USDT: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
      BUSD: '0x833D8Eb16D306ed1FbB5D7A2E019e106B960965A',
      USDP: '0x09023c0DA49Aaf8fc3fA3ADF34C6A7016D38D5e3',
      TUSD: '0xec746eCF986E2927Abd291a2A1716c940100f8Ba',
      ETH: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
      WBTC: '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23',
      BTC: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      EURT: '0x01D391A48f4F7339aC64CA2c83a07C22F95F587a',
      EUR: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
    },
    AAVE_LENDING_POOL: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    AAVE_INCENTIVES: '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    AAVE_EMISSIONS_MGR: '0xEE56e2B3D491590B5b31738cC34d5232F378a8D5',
    COMPTROLLER: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    GNOSIS_EASY_AUCTION: '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
    EASY_AUCTION_OWNER: '0x0da0c3e52c977ed3cbc641ff02dd271c3ed55afe',
  },
  '3': {
    name: 'ropsten',
    tokens: {
      USDC: '0x07865c6e87b9f70255377e024ace6630c1eaa37f',
      RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
    },
    chainlinkFeeds: {},
    COMPTROLLER: '0xcfa7b0e37f5AC60f3ae25226F5e39ec59AD26152',
  },
  '1': {
    name: 'mainnet',
    tokens: {
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      BUSD: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
      USDP: '0x8E870D67F660D95d5be530380D0eC0bd388289E1',
      TUSD: '0x0000000000085d4780B73119b644AE5ecd22b376',
      aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      aUSDC: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      aBUSD: '0xA361718326c15715591c299427c62086F69923D9',
      cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      cUSDT: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
      cETH: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
      cWBTC: '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4',
      AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      stkAAVE: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
      COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      EURT: '0xC581b735A1688071A1746c968e0798D642EDE491',
      RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
    },
    chainlinkFeeds: {
      RSR: '0x759bBC1be8F90eE6457C44abc7d443842a976d02',
      AAVE: '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
      COMP: '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5',
      DAI: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
      USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      USDT: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
      BUSD: '0x833D8Eb16D306ed1FbB5D7A2E019e106B960965A',
      USDP: '0x09023c0DA49Aaf8fc3fA3ADF34C6A7016D38D5e3',
      TUSD: '0xec746eCF986E2927Abd291a2A1716c940100f8Ba',
      ETH: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
      WBTC: '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23',
      BTC: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      EURT: '0x01D391A48f4F7339aC64CA2c83a07C22F95F587a',
      EUR: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
    },
    AAVE_LENDING_POOL: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    AAVE_INCENTIVES: '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    AAVE_EMISSIONS_MGR: '0xEE56e2B3D491590B5b31738cC34d5232F378a8D5',
    COMPTROLLER: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    GNOSIS_EASY_AUCTION: '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
    EASY_AUCTION_OWNER: '0x0da0c3e52c977ed3cbc641ff02dd271c3ed55afe',
  },
}

export const getNetworkConfig = (chainId: string) => {
  if (!networkConfig[chainId]) {
    throw new Error(`Configuration for network ${chainId} not available`)
  }
  return networkConfig[chainId]
}

export const developmentChains = ['hardhat', 'localhost']

export interface TradingRange {
  min: BigNumberish
  max: BigNumberish
}

// Common configuration interfaces
export interface IConfig {
  tradingRange: TradingRange
  dist: IRevenueShare
  rewardPeriod: BigNumber
  rewardRatio: BigNumber
  unstakingDelay: BigNumber
  tradingDelay: BigNumber
  auctionLength: BigNumber
  backingBuffer: BigNumber
  maxTradeSlippage: BigNumber
  issuanceRate: BigNumber
  oneshotFreezeDuration: BigNumber
}

export interface IRevenueShare {
  rTokenDist: BigNumber
  rsrDist: BigNumber
}

export interface IComponents {
  assetRegistry: string
  backingManager: string
  basketHandler: string
  broker: string
  distributor: string
  furnace: string
  rsrTrader: string
  rTokenTrader: string
  rToken: string
  stRSR: string
}

export interface IImplementations {
  main: string
  trade: string
  components: IComponents
}

export interface IRTokenConfig {
  name: string
  symbol: string
  manifestoURI: string
  params: IConfig
}

export interface IBackupInfo {
  backupUnit: string
  diversityFactor: BigNumber
  backupCollateral: string[]
}

export interface IRTokenSetup {
  assets: string[]
  primaryBasket: string[]
  weights: BigNumber[]
  backups: IBackupInfo[]
}

export interface IGovParams {
  votingDelay: BigNumber
  votingPeriod: BigNumber
  proposalThresholdAsMicroPercent: BigNumber
  quorumPercent: BigNumber
  minDelay: BigNumber
}

// System constants
export const MAX_TRADE_SLIPPAGE = fp('1')
export const MAX_BACKING_BUFFER = fp('1')
export const MAX_TARGET_AMT = fp(1e3)
export const MAX_RATIO = fp('1')
export const MAX_ISSUANCE_RATE = fp('1')
export const MAX_TRADE_VOLUME = pow10(48)

// Timestamps
export const MAX_ORACLE_TIMEOUT = BigNumber.from(2).pow(32).sub(1)
export const MAX_TRADING_DELAY = 31536000 // 1 year
export const MAX_AUCTION_LENGTH = 604800 // 1 week
export const MAX_PERIOD = 31536000 // 1 year
export const MAX_UNSTAKING_DELAY = 31536000 // 1 year
