import { networkConfig } from "#/common/configuration";

export const whales: { [key: string]: string } = {
  [networkConfig['1'].tokens.USDT!.toLowerCase()]: '0x5754284f345afc66a98fbB0a0Afe71e0F007B949',
  [networkConfig['1'].tokens.cUSDT!.toLowerCase()]: '0x5754284f345afc66a98fbB0a0Afe71e0F007B949',
  [networkConfig['1'].tokens.aUSDT!.toLowerCase()]: '0x5754284f345afc66a98fbB0a0Afe71e0F007B949',
  ['0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()]: '0x5754284f345afc66a98fbB0a0Afe71e0F007B949', // saUSDT
  [networkConfig['1'].tokens.USDC!.toLowerCase()]: '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC',
  [networkConfig['1'].tokens.aUSDC!.toLowerCase()]: '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC',
  [networkConfig['1'].tokens.cUSDC!.toLowerCase()]: '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC',
  ['0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()]: '0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC', // saUSDC
  [networkConfig['1'].tokens.RSR!.toLowerCase()]: '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1',
}

export const collateralToUnderlying: { [key: string]: string } = {
  ['0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase()]: networkConfig['1'].tokens.USDT!.toLowerCase(),
  ['0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase()]: networkConfig['1'].tokens.USDC!.toLowerCase(),
  [networkConfig['1'].tokens.cUSDT!.toLowerCase()]: networkConfig['1'].tokens.USDT!.toLowerCase(),
  [networkConfig['1'].tokens.cUSDC!.toLowerCase()]: networkConfig['1'].tokens.USDC!.toLowerCase()
}