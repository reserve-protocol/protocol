import { networkConfig } from "#/common/configuration";

export const whales: { [key: string]: string } = {
  [networkConfig['1'].tokens.USDT!]: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
  [networkConfig['1'].tokens.USDC!]: '0x756D64Dc5eDb56740fC617628dC832DDBCfd373c',
  [networkConfig['1'].tokens.RSR!]: '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1',
}