import { BigNumber } from 'ethers'

export interface ITokens {
  DAI?: string
  USDC?: string
  USDT?: string
  BUSD?: string
  aDAI?: string
  aUSDC?: string
  aUSDT?: string
  aBUSD?: string
  aWETH?: string
  cDAI?: string
  cUSDC?: string
  cUSDT?: string
  stkAAVE?: string
  COMP?: string
  WETH?: string
}

interface INetworkConfig {
  name: string
  tokens: ITokens
  RSR?: string
  AAVE_LENDING_POOL?: string
  AAVE_INCENTIVES?: string
  AAVE_EMISSIONS_MGR?: string
  COMPTROLLER?: string
  GNOSIS_EASY_AUCTION?: string
}

export const networkConfig: { [key: string]: INetworkConfig } = {
  default: {
    name: 'hardhat',
    tokens: {},
  },
  // Config used for Mainnet forking -- Mirrors mainnet
  '31337': {
    name: 'localhost',
    tokens: {
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      BUSD: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
      aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      aUSDC: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      aBUSD: '0xA361718326c15715591c299427c62086F69923D9',
      aWETH: '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
      cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      cUSDT: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
      stkAAVE: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
      COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    },
    RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
    AAVE_LENDING_POOL: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    AAVE_INCENTIVES: '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    AAVE_EMISSIONS_MGR: '0xEE56e2B3D491590B5b31738cC34d5232F378a8D5',
    COMPTROLLER: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    GNOSIS_EASY_AUCTION: '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
  },
  '3': {
    name: 'ropsten',
    RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
    tokens: {
      USDC: '0x07865c6e87b9f70255377e024ace6630c1eaa37f',
    },
    COMPTROLLER: '0xcfa7b0e37f5AC60f3ae25226F5e39ec59AD26152',
  },
  '1': {
    name: 'mainnet',
    tokens: {
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      BUSD: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
      aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      aUSDC: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      aBUSD: '0xA361718326c15715591c299427c62086F69923D9',
      cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      cUSDT: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
      stkAAVE: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
      COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    },
    RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
    AAVE_LENDING_POOL: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    AAVE_INCENTIVES: '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    AAVE_EMISSIONS_MGR: '0xEE56e2B3D491590B5b31738cC34d5232F378a8D5',
    COMPTROLLER: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    GNOSIS_EASY_AUCTION: '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
  },
}

export const getNetworkConfig = (chainId: string) => {
  if (!networkConfig[chainId]) {
    throw new Error(`Configuration for network ${chainId} not available`)
  }
  return networkConfig[chainId]
}

export const developmentChains = ['hardhat', 'localhost']

// Common configuration interfaces
export interface IConfig {
  maxTradeVolume: BigNumber
  dist: IRevenueShare
  rewardPeriod: BigNumber
  rewardRatio: BigNumber
  unstakingDelay: BigNumber
  tradingDelay: BigNumber
  auctionLength: BigNumber
  backingBuffer: BigNumber
  maxTradeSlippage: BigNumber
  dustAmount: BigNumber
  issuanceRate: BigNumber
  oneshotPauseDuration: BigNumber
  minBidSize: BigNumber
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
