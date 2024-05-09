import { networkConfig } from '#/common/configuration'

export const whales: { [key: string]: string } = {
  [networkConfig['1'].tokens.USDT!.toLowerCase()]: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
  [networkConfig['1'].tokens.USDC!.toLowerCase()]: '0xAFAaDfa18D9d63d09F19a5445e29CEc601054C5e',
  [networkConfig['1'].tokens.pyUSD!.toLowerCase()]: '0xA5588F7cdf560811710A2D82D3C9c99769DB1Dcb',
  [networkConfig['1'].tokens.RSR!.toLowerCase()]: '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1',
  [networkConfig['1'].tokens.cUSDT!.toLowerCase()]: '0xb99CC7e10Fe0Acc68C50C7829F473d81e23249cc',
  [networkConfig['1'].tokens.aUSDT!.toLowerCase()]: '0x0B6B712B0f3998961Cd3109341b00c905b16124A',
  ['0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()]:
    '0x5754284f345afc66a98fbB0a0Afe71e0F007B949', // saUSDT
  ['0x4Be33630F92661afD646081BC29079A38b879aA0'.toLowerCase()]:
    '0x5754284f345afc66a98fbB0a0Afe71e0F007B949', // cUSDTVault

  [networkConfig['1'].tokens.aUSDC!.toLowerCase()]: '0x777777c9898D384F785Ee44Acfe945efDFf5f3E0',
  [networkConfig['1'].tokens.cUSDC!.toLowerCase()]: '0x97D868b5C2937355Bf89C5E5463d52016240fE86',
  [networkConfig['1'].tokens.cUSDCv3!.toLowerCase()]: '0x7f714b13249BeD8fdE2ef3FBDfB18Ed525544B03',
  ['0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()]:
    '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC', // saUSDC
  ['0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022'.toLowerCase()]:
    '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC', // cUSDCVault
  [networkConfig['1'].tokens.RSR!.toLowerCase()]: '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1',
  [networkConfig['1'].tokens.WBTC!.toLowerCase()]: '0x8eb8a3b98659cce290402893d0123abb75e3ab28',
  [networkConfig['1'].tokens.stETH!.toLowerCase()]: '0x176F3DAb24a159341c0509bB36B833E7fdd0a132',
  [networkConfig['1'].tokens.WETH!.toLowerCase()]: '0x8EB8a3b98659Cce290402893d0123abb75E3ab28',
  [networkConfig['1'].tokens.DAI!.toLowerCase()]: '0x8EB8a3b98659Cce290402893d0123abb75E3ab28',
  [networkConfig['1'].tokens.CRV!.toLowerCase()]: '0xf977814e90da44bfa03b6295a0616a897441acec',
  ['0xAEda92e6A3B1028edc139A4ae56Ec881f3064D4F'.toLowerCase()]:
    '0x8605dc0C339a2e7e85EEA043bD29d42DA2c6D784', // cvxeUSDFRAXBP LP token
  [networkConfig['1'].tokens.sDAI!.toLowerCase()]: '0x4aa42145Aa6Ebf72e164C9bBC74fbD3788045016',
  ['0xa0d69e286b938e21cbf7e51d71f6a4c8918f482f'.toLowerCase()]:
    '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', // eUSD
  ['0xacdf0dba4b9839b96221a8487e9ca660a48212be'.toLowerCase()]:
    '0x8a8434A5952aC2CF4927bbEa3ace255c6dd165CD', // hyUSD
}

export const collateralToUnderlying: { [key: string]: string } = {
  ['0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()]:
    networkConfig['1'].tokens.USDT!.toLowerCase(),
  ['0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()]:
    networkConfig['1'].tokens.USDC!.toLowerCase(),
  [networkConfig['1'].tokens.cUSDT!.toLowerCase()]: networkConfig['1'].tokens.USDT!.toLowerCase(),
  [networkConfig['1'].tokens.cUSDC!.toLowerCase()]: networkConfig['1'].tokens.USDC!.toLowerCase(),
  [networkConfig['1'].tokens.saEthUSDC!.toLowerCase()]:
    networkConfig['1'].tokens.aEthUSDC!.toLowerCase(),
}

export interface RTokenDeployment {
  rToken: string
  governor: string
  timelock: string
}

export const MAINNET_DEPLOYMENTS: RTokenDeployment[] = [
  {
    rToken: '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F', // eUSD
    governor: '0x7e880d8bD9c9612D6A9759F96aCD23df4A4650E6',
    timelock: '0xc8Ee187A5e5c9dC9b42414Ddf861FFc615446a2c',
  },
  {
    rToken: '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8', // ETH+
    governor: '0x239cDcBE174B4728c870A24F77540dAB3dC5F981',
    timelock: '0x5f4A10aE2fF68bE3cdA7d7FB432b10C6BFA6457B',
  },
  {
    rToken: '0xaCdf0DBA4B9839b96221a8487e9ca660a48212be', // hyUSD (mainnet)
    governor: '0x22d7937438b4bBf02f6cA55E3831ABB94Bd0b6f1',
    timelock: '0x624f9f076ED42ba3B37C3011dC5a1761C2209E1C',
  },
  {
    rToken: '0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b', // USDC+
    governor: '0xc837C557071D604bCb1058c8c4891ddBe8FDD630',
    timelock: '0x6C957417cB6DF6e821eec8555DEE8b116C291999',
  },
  {
    rToken: '0x0d86883FAf4FfD7aEb116390af37746F45b6f378', // USD3
    governor: '0x020CB71181008369C388CaAEE98b0E69f8F4C471',
    timelock: '0xE0289984F709fc7150E646B672bfaDC879a15f14',
  },
  {
    rToken: '0x78da5799CF427Fee11e9996982F4150eCe7a99A7', // rgUSD
    governor: '0x409bAc94c4207C6627EA5f4E4FFB7128e8F654Fc',
    timelock: '0x9aD9E73e38c8506a664A3A37e8A9CE910B6FBeb4',
  },
]

export const BASE_DEPLOYMENTS: RTokenDeployment[] = [
  {
    rToken: '0xCc7FF230365bD730eE4B352cC2492CEdAC49383e', // hyUSD (base)
    governor: '0xc8e63d3501A246fa1ddBAbe4ad0B50e9d32aA8bb',
    timelock: '0xf093d7f00f3dCe6d415Be564f41Cb4bc032fb367',
  },
  {
    rToken: '0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff', // bsdETH
    governor: '0xB05C6a7242595f2E23CC6a0aB20699d63D0939Fd',
    timelock: '0x321f7493B8B675dFfE2570Bd0F164237D445b9E8',
  },
  {
    rToken: '0xfE0D6D83033e313691E96909d2188C150b834285', // iUSDC - Assets skipped (USDbC)
    governor: '0xfe637F7D5B848392c19052631d68F8AC859F71cF',
    timelock: '0xd18ED37CA912bbf1EDE93d27459d03DC4343dea1',
  },
  {
    rToken: '0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d', // Vaya - Assets skipped (USDbC)
    governor: '0xEb583EA06501f92E994C353aD2741A35582987aA',
    timelock: '0xeE3eC997A37e661a42673D7A489Fbf0E5ed0C223',
  },
  {
    rToken: '0x641B0453487C9D14c5df96d45a481ef1dc84e31f', // MAAT
    governor: '0x0f7f1442dA7F687BB877Fbee0539FA8D6e4d1a02',
    timelock: '0xE67cEb03EfdF9B3fb5C3FeBF3103e2efd3a76A1b',
  },
]
