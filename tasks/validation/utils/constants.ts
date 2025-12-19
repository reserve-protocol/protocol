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

export interface OracleConfig {
  address: string
  threshold: number // Allowed deviation percentage (e.g., 0.5 = 0.5%)
}

export interface RTokenDeployment {
  rToken: string
  governor: string
  timelock: string
  oracle?: OracleConfig // Optional (RToken oracle)
}

export const MAINNET_DEPLOYMENTS: RTokenDeployment[] = [
  {
    rToken: '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F', // eUSD
    governor: '0xf4A9288D5dEb0EaE987e5926795094BF6f4662F8',
    timelock: '0x7BEa807798313fE8F557780dBD6b829c1E3aD560',
  },
  {
    rToken: '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8', // ETH+
    governor: '0x868Fe81C276d730A1995Dc84b642E795dFb8F753',
    timelock: '0x5d8A7DC9405F08F14541BA918c1Bf7eb2dACE556',
    oracle: {
      address: '0xf87d2F4d42856f0B6Eae140Aaf78bF0F777e9936',
      threshold: 0.5,
    },
  },
  /*{
    rToken: '0xaCdf0DBA4B9839b96221a8487e9ca660a48212be', // hyUSD (mainnet)
    governor: '0x3F26EF1460D21A99425569Ef3148Ca6059a7eEAe',
    timelock: '0x788Fd297B4d497e44e4BF25d642fbecA3018B5d2',
  },*/
  {
    rToken: '0x0d86883FAf4FfD7aEb116390af37746F45b6f378', // USD3
    governor: '0x441808e20E625e0094b01B40F84af89436229279',
    timelock: '0x12e4F043c6464984A45173E0444105058b6C3c7B',
  },
  // {
  //   rToken: '0x005f893ecd7bf9667195642f7649da8163e23658', // dgnETH
  //   governor: '0xb7cB3880564A1F8698018ECDc78972F93b2615e6',
  //   timelock: '0x05623fcEe6FB48b7C8058022C48A72dbce09878e',
  // },
]

export const BASE_DEPLOYMENTS: RTokenDeployment[] = [
  {
    rToken: '0xCc7FF230365bD730eE4B352cC2492CEdAC49383e', // hyUSD (base)
    governor: '0xffef97179f58a582dEf73e6d2e4BcD2BDC8ca128',
    timelock: '0x4284D76a03F9B398FF7aEc58C9dEc94b289070CF',
  },
  {
    rToken: '0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff', // bsdETH
    governor: '0x21fBa52dA03e1F964fa521532f8B8951fC212055',
    timelock: '0xe664d294824C2A8C952A10c4034e1105d2907F46',
    oracle: {
      address: '0xD41310aCF5fA54CDd1970155ac32D708B376Dff6',
      threshold: 1.25, // Higher threshold to account for melting and time elapsed
    },
  },
]
