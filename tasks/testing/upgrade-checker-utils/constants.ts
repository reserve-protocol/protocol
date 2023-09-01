import { networkConfig } from '#/common/configuration'

export const whales: { [key: string]: string } = {
  [networkConfig['1'].tokens.USDT!.toLowerCase()]: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
  [networkConfig['1'].tokens.USDC!.toLowerCase()]: '0x756D64Dc5eDb56740fC617628dC832DDBCfd373c',
  [networkConfig['1'].tokens.RSR!.toLowerCase()]: '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1',
  [networkConfig['1'].tokens.cUSDT!.toLowerCase()]: '0xb99CC7e10Fe0Acc68C50C7829F473d81e23249cc',
  [networkConfig['1'].tokens.aUSDT!.toLowerCase()]: '0x0B6B712B0f3998961Cd3109341b00c905b16124A',
  ['0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()]:
    '0x5754284f345afc66a98fbB0a0Afe71e0F007B949', // saUSDT
  //  TODO: Replace with real address
  ['0x840748F7Fd3EA956E5f4c88001da5CC1ABCBc038'.toLowerCase()]:
    '0x5754284f345afc66a98fbB0a0Afe71e0F007B949', // cUSDTVault

  [networkConfig['1'].tokens.aUSDC!.toLowerCase()]: '0x777777c9898D384F785Ee44Acfe945efDFf5f3E0',
  [networkConfig['1'].tokens.cUSDC!.toLowerCase()]: '0x97D868b5C2937355Bf89C5E5463d52016240fE86',
  ['0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()]:
    '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC', // saUSDC
  //  TODO: Replace with real address
  ['0xf201fFeA8447AB3d43c98Da3349e0749813C9009'.toLowerCase()]:
    '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC', // cUSDCVault

  [networkConfig['1'].tokens.RSR!.toLowerCase()]: '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1',
  [networkConfig['1'].tokens.WBTC!.toLowerCase()]: '0x8eb8a3b98659cce290402893d0123abb75e3ab28',
  [networkConfig['1'].tokens.stETH!.toLowerCase()]: '0x176F3DAb24a159341c0509bB36B833E7fdd0a132',
  [networkConfig['1'].tokens.WETH!.toLowerCase()]: '0x8EB8a3b98659Cce290402893d0123abb75E3ab28',
  [networkConfig['1'].tokens.DAI!.toLowerCase()]: '0x8EB8a3b98659Cce290402893d0123abb75E3ab28',
  [networkConfig['1'].tokens.CRV!.toLowerCase()]: '0xf977814e90da44bfa03b6295a0616a897441acec',
}

export const collateralToUnderlying: { [key: string]: string } = {
  ['0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()]:
    networkConfig['1'].tokens.USDT!.toLowerCase(),
  ['0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()]:
    networkConfig['1'].tokens.USDC!.toLowerCase(),
  [networkConfig['1'].tokens.cUSDT!.toLowerCase()]: networkConfig['1'].tokens.USDT!.toLowerCase(),
  [networkConfig['1'].tokens.cUSDC!.toLowerCase()]: networkConfig['1'].tokens.USDC!.toLowerCase(),
}
