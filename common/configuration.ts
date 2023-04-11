import { BigNumber } from 'ethers'

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
  FRAX?: string
  MIM?: string
  eUSD?: string
  aDAI?: string
  aUSDC?: string
  aUSDT?: string
  aBUSD?: string
  aUSDP?: string
  aWETH?: string
  cDAI?: string
  cUSDC?: string
  cUSDT?: string
  cUSDP?: string
  cETH?: string
  cWBTC?: string
  fUSDC?: string
  fUSDT?: string
  fFRAX?: string
  fDAI?: string
  AAVE?: string
  stkAAVE?: string
  COMP?: string
  WETH?: string
  WBTC?: string
  EURT?: string
  RSR?: string
  CRV?: string
  CVX?: string
  ankrETH?: string
  frxETH?: string
  sfrxETH?: string
  stETH?: string
  wstETH?: string
  rETH?: string
  cUSDCv3?: string
}

export interface IFeeds {
  stETHETH?: string
  stETHUSD?: string
}

export interface IPlugins {
  cvx3Pool?: string
  cvxeUSDFRAXBP?: string
  cvxTriCrypto?: string
  cvxMIM3Pool?: string
}

interface INetworkConfig {
  name: string
  tokens: ITokens
  chainlinkFeeds: ITokens & ICurrencies & IFeeds
  AAVE_LENDING_POOL?: string
  AAVE_INCENTIVES?: string
  AAVE_EMISSIONS_MGR?: string
  COMPTROLLER?: string
  FLUX_FINANCE_COMPTROLLER?: string
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
      FRAX: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
      MIM: '0x99d8a9c45b2eca8864373a26d1459e3dff1e17f3',
      eUSD: '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F',
      aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      aUSDC: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      aBUSD: '0xA361718326c15715591c299427c62086F69923D9',
      aUSDP: '0x2e8F4bdbE3d47d7d7DE490437AeA9915D930F1A3',
      aWETH: '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
      cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      cUSDT: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
      cUSDP: '0x041171993284df560249B57358F931D9eB7b925D',
      cETH: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
      cWBTC: '0xccF4429DB6322D5C611ee964527D42E5d685DD6a',
      fUSDC: '0x465a5a630482f3abD6d3b84B39B29b07214d19e5',
      fUSDT: '0x81994b9607e06ab3d5cF3AffF9a67374f05F27d7',
      fFRAX: '0x1C9A2d6b33B4826757273D47ebEe0e2DddcD978B',
      fDAI: '0xe2bA8693cE7474900A045757fe0efCa900F6530b',
      AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      stkAAVE: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
      COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      EURT: '0xC581b735A1688071A1746c968e0798D642EDE491',
      RSR: '0x320623b8E4fF03373931769A31Fc52A4E78B5d70',
      CRV: '0xD533a949740bb3306d119CC777fa900bA034cd52',
      CVX: '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B',
      ankrETH: '0xE95A203B1a91a908F9B9CE46459d101078c2c3cb',
      frxETH: '0x5E8422345238F34275888049021821E8E08CAa1f',
      sfrxETH: '0xac3E018457B222d93114458476f3E3416Abbe38F',
      stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      rETH: '0xae78736Cd615f374D3085123A210448E74Fc6393',
      cUSDCv3: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
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
      FRAX: '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD',
      MIM: '0x7A364e8770418566e3eb2001A96116E6138Eb32F',
      ETH: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
      WBTC: '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23',
      BTC: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      EURT: '0x01D391A48f4F7339aC64CA2c83a07C22F95F587a',
      EUR: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
      CVX: '0xd962fC30A72A84cE50161031391756Bf2876Af5D',
      CRV: '0xCd627aA160A6fA45Eb793D19Ef54f5062F20f33f',
      stETHETH: '0x86392dc19c0b719886221c78ab11eb8cf5c52812', // stETH/ETH
      stETHUSD: '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8', // stETH/USD
      rETH: '0x536218f9E9Eb48863970252233c8F271f554C2d0', // rETH/ETH
    },
    AAVE_LENDING_POOL: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    AAVE_INCENTIVES: '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    AAVE_EMISSIONS_MGR: '0xEE56e2B3D491590B5b31738cC34d5232F378a8D5',
    FLUX_FINANCE_COMPTROLLER: '0x95Af143a021DF745bc78e845b54591C53a8B3A51',
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
      FRAX: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
      MIM: '0x99d8a9c45b2eca8864373a26d1459e3dff1e17f3',
      eUSD: '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F',
      aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      aUSDC: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      aBUSD: '0xA361718326c15715591c299427c62086F69923D9',
      aUSDP: '0x2e8F4bdbE3d47d7d7DE490437AeA9915D930F1A3',
      aWETH: '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
      cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      cUSDT: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
      cUSDP: '0x041171993284df560249B57358F931D9eB7b925D',
      cETH: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
      cWBTC: '0xccF4429DB6322D5C611ee964527D42E5d685DD6a',
      fUSDC: '0x465a5a630482f3abD6d3b84B39B29b07214d19e5',
      fUSDT: '0x81994b9607e06ab3d5cF3AffF9a67374f05F27d7',
      fFRAX: '0x1C9A2d6b33B4826757273D47ebEe0e2DddcD978B',
      fDAI: '0xe2bA8693cE7474900A045757fe0efCa900F6530b',
      AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      stkAAVE: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
      COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      EURT: '0xC581b735A1688071A1746c968e0798D642EDE491',
      RSR: '0x320623b8e4ff03373931769a31fc52a4e78b5d70',
      CRV: '0xD533a949740bb3306d119CC777fa900bA034cd52',
      CVX: '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B',
      ankrETH: '0xE95A203B1a91a908F9B9CE46459d101078c2c3cb',
      frxETH: '0x5E8422345238F34275888049021821E8E08CAa1f',
      sfrxETH: '0xac3E018457B222d93114458476f3E3416Abbe38F',
      stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      rETH: '0xae78736Cd615f374D3085123A210448E74Fc6393',
      cUSDCv3: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
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
      FRAX: '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD',
      MIM: '0x7A364e8770418566e3eb2001A96116E6138Eb32F',
      ETH: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
      WBTC: '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23',
      BTC: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      EURT: '0x01D391A48f4F7339aC64CA2c83a07C22F95F587a',
      EUR: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
      CVX: '0xd962fC30A72A84cE50161031391756Bf2876Af5D',
      CRV: '0xCd627aA160A6fA45Eb793D19Ef54f5062F20f33f',
      stETHETH: '0x86392dc19c0b719886221c78ab11eb8cf5c52812', // stETH/ETH
      stETHUSD: '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8', // stETH/USD
      rETH: '0x536218f9E9Eb48863970252233c8F271f554C2d0', // rETH/ETH
    },
    AAVE_LENDING_POOL: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    FLUX_FINANCE_COMPTROLLER: '0x95Af143a021DF745bc78e845b54591C53a8B3A51',
    COMPTROLLER: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    GNOSIS_EASY_AUCTION: '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101',
  },
  '5': {
    name: 'goerli',
    tokens: {
      // mocks
      DAI: '0x4E35fAA0c4e6BA16534aa28DE0e40f7b702642D3',
      USDC: '0x9276fC221399d81a848E9d543a6FAA5e741E40A7',
      USDT: '0xAE64954A904da3fD9D71945980A849B8A9F755d7',
      BUSD: '0x66FE0f43D9f201474A54a3857c77599DEBbD38F4',
      USDP: '0x5d3E908ff0649F01d51d1513132736e96477C15d',
      TUSD: '0x56e938BC973fB23aCd7f043Fc11b61b1Ae3DDcC5',
      FRAX: '0x85b256e9051B781A0BC0A987857AD6166C94040a',
      aDAI: '0x8bf8dd4FEf62b4bC942482793f75b1606b9A4Cb0',
      aUSDC: '0x9Fc379726c48A391a4F3Fb8b105184D3c9142E24',
      aUSDT: '0xB2fdE37a7C1c521C25C36f29109bFbBE13893994',
      aBUSD: '0x5Ebd4D0F79D0baEb2b0aEfe3395A930bb26ABc80',
      aUSDP: '0x4E01677488384B851EeAa09C8b8F6Dd0b16d7E9B',
      cDAI: '0xf6508Db0cfCADa4dE3d3e55F7AdB189f19390cB6',
      cUSDC: '0x057357b22Fd6A629367b5434c2af0D5bf44533A8',
      cUSDT: '0x4950dDbBaBa1aEB9b4FAada6B0ADE3DD3bCc0380',
      cUSDP: '0x199E12d58B36deE2D2B3dD2b91aD7bb25c787a71',
      cETH: '0x84E8e5dd7BfD8E9EFa2783eE438091cd17caFb0A',
      cWBTC: '0x3Bd9452C4987e6D5EF3748Bb1230CbefA36617EC',
      fUSDC: '0x8b06c065b4b44B310442d4ee98777BF7a1EBC6E3',
      fUSDT: '0xb3dCcEf35647A8821C76f796bE8B5426Cc953412',
      fFRAX: '0x7906238833Bb9e4Fec24a1735C94f47cb194f678',
      fDAI: '0x7e1e077b289c0153b5ceAD9F264d66215341c9Ab',
      AAVE: '0xc47324262e1C7be67270Da717e1a0e7b0191c449',
      stkAAVE: '0x3Db8b170DA19c45B63B959789f20f397F22767D4',
      COMP: '0x1b4449895037f25b102B28B45b8bD50c8C44Aca1',
      WETH: '0xB5B58F0a853132EA8cB614cb17095dE87AF3E98b',
      WBTC: '0x528FdEd7CC39209ed67B4edA11937A9ABe1f6249',
      EURT: '0xD6da5A7ADE2a906d9992612752A339E3485dB508',
      RSR: '0xB58b5530332D2E9e15bfd1f2525E6fD84e830307',
    },
    chainlinkFeeds: {
      ETH: '0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e', // canonical chainlink
      BTC: '0xA39434A63A52E749F02807ae27335515BA4b07F7', // canonical chainlink
      // mocks below, we shouldn't have to touch these unless causing default
      RSR: '0x905084691C2c7505b5FC63229621621b616bbbFe',
      AAVE: '0xcba876375c5144722BB665A9312A02Ba77865D28',
      COMP: '0x00e95ea8009f3B01c2ceC5AA7143F73C23136f45',
      DAI: '0xD460dCC7Cefb2128337bfEd8d6bEed0e6E9C7E6A',
      USDC: '0x93Edc2F8b5388e01c5c26Dc22B32c68892FA2821',
      USDT: '0x3684603B1d8CE070852CB718f76f452030889556',
      BUSD: '0x61aC9ac5C045DBe833bAb1C0D37632F121068244',
      USDP: '0x847AE3320763A86eeCB993C26a54417fE6F55a6E',
      TUSD: '0x96aeE109dF58D4391C965FAbc2625f92dB363410',
      FRAX: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      WBTC: '0xe52CE9436F2D4D4B744720aAEEfD9C6dbFC00b34',
      EURT: '0x68aA66BCde901c741C5EF07314875434E51E5D30',
      EUR: '0x12336777de46b9a6Edd7176E532810149C787bcD',
    },
    AAVE_LENDING_POOL: '0x3e9E33B84C1cD9037be16AA45A0B296ae5F185AD', // mock
    GNOSIS_EASY_AUCTION: '0x1fbab40c338e2e7243da945820ba680c92ef8281', // canonical
    COMPTROLLER: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b', // canonical
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
  dist: IRevenueShare
  minTradeVolume: BigNumber
  rTokenMaxTradeVolume: BigNumber
  shortFreeze: BigNumber
  longFreeze: BigNumber
  rewardRatio: BigNumber
  unstakingDelay: BigNumber
  tradingDelay: BigNumber
  auctionLength: BigNumber
  backingBuffer: BigNumber
  maxTradeSlippage: BigNumber
  issuanceThrottle: ThrottleParams
  redemptionThrottle: ThrottleParams
}

export interface IRevenueShare {
  rTokenDist: BigNumber
  rsrDist: BigNumber
}

export interface ThrottleParams {
  amtRate: BigNumber
  pctRate: BigNumber
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
  mandate: string
  params: IConfig
}

export interface IBackupInfo {
  backupUnit: string
  diversityFactor: BigNumber
  backupCollateral: string[]
}

export interface IBeneficiaryInfo {
  beneficiary: string
  revShare: IRevenueShare
}

export interface IRTokenSetup {
  assets: string[]
  primaryBasket: string[]
  weights: BigNumber[]
  backups: IBackupInfo[]
  beneficiaries: IBeneficiaryInfo[]
}

export interface IGovParams {
  votingDelay: BigNumber
  votingPeriod: BigNumber
  proposalThresholdAsMicroPercent: BigNumber
  quorumPercent: BigNumber
  timelockDelay: BigNumber
}

// System constants
export const MAX_TRADE_SLIPPAGE = BigNumber.from(10).pow(18)
export const MAX_BACKING_BUFFER = BigNumber.from(10).pow(18)
export const MAX_TARGET_AMT = BigNumber.from(10).pow(21)
export const MAX_RATIO = BigNumber.from(10).pow(18)
export const MAX_TRADE_VOLUME = BigNumber.from(10).pow(48)
export const MAX_MIN_TRADE_VOLUME = BigNumber.from(10).pow(29)
export const MIN_THROTTLE_AMT_RATE = BigNumber.from(10).pow(18)
export const MAX_THROTTLE_AMT_RATE = BigNumber.from(10).pow(48)
export const MAX_THROTTLE_PCT_RATE = BigNumber.from(10).pow(18)

// Timestamps
export const MAX_ORACLE_TIMEOUT = BigNumber.from(2).pow(48).sub(1)
export const MAX_TRADING_DELAY = 31536000 // 1 year
export const MAX_AUCTION_LENGTH = 604800 // 1 week
export const MAX_UNSTAKING_DELAY = 31536000 // 1 year
export const MAX_DELAY_UNTIL_DEFAULT = 1209600 // 2 weeks
