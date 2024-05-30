import fs from 'fs'

export interface Whales {
  [key: string]: string
}
export interface Updated {
  [key: string]: string
}

export interface NetworkWhales {
  tokens: Whales
  lastUpdated: Updated
}

export interface RTokens {
  [key: string]: string[]
}

export const RTOKENS: RTokens = {
  // mainnet
  '1': [
    '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F'.toLowerCase(), // eUSD
    '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8'.toLowerCase(), // ETH+
    '0xaCdf0DBA4B9839b96221a8487e9ca660a48212be'.toLowerCase(), // hyUSD
    '0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b'.toLowerCase(), // USDC+
    '0x0d86883FAf4FfD7aEb116390af37746F45b6f378'.toLowerCase(), // USD3
    '0x78da5799CF427Fee11e9996982F4150eCe7a99A7'.toLowerCase(), // rgUSD
  ],
  // hardhat
  '31337': [
    '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F'.toLowerCase(), // eUSD
    '0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8'.toLowerCase(), // ETH+
    '0xaCdf0DBA4B9839b96221a8487e9ca660a48212be'.toLowerCase(), // hyUSD
    '0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b'.toLowerCase(), // USDC+
    '0x0d86883FAf4FfD7aEb116390af37746F45b6f378'.toLowerCase(), // USD3
    '0x78da5799CF427Fee11e9996982F4150eCe7a99A7'.toLowerCase(), // rgUSD
  ],
  // base
  '8453': [
    '0xCfA3Ef56d303AE4fAabA0592388F19d7C3399FB4'.toLowerCase(), // eUSD
    '0xEFb97aaF77993922aC4be4Da8Fbc9A2425322677'.toLowerCase(), // USDC3
    '0x8E5E9DF4F0EA39aE5270e79bbABFCc34203A3470'.toLowerCase(), // rgUSD
    '0xCc7FF230365bD730eE4B352cC2492CEdAC49383e'.toLowerCase(), // hyUSD
    '0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff'.toLowerCase(), // bsdETH
    '0xfE0D6D83033e313691E96909d2188C150b834285'.toLowerCase(), // iUSDC
    '0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d'.toLowerCase(), // VAYA
    '0x641B0453487C9D14c5df96d45a481ef1dc84e31f'.toLowerCase(), // MAAT
  ],
  // arbitrum
  '42161': [
    '0x12275DCB9048680c4Be40942eA4D92c74C63b844'.toLowerCase(), // eUSD
    '0x18c14c2d707b2212e17d1579789fc06010cfca23'.toLowerCase(), // ETH+
    '0x96a993f06951b01430523d0d5590192d650ebf3e'.toLowerCase(), // rgUSD
  ],
}

export function getWhalesFileName(chainId: string | number): string {
  return `./tasks/validation/whales/whales_${chainId}.json`
}

export function getWhalesFile(chainId: string | number): NetworkWhales {
  const whalesFile = getWhalesFileName(chainId)
  const whales: NetworkWhales = JSON.parse(fs.readFileSync(whalesFile, 'utf8'))
  return whales
}
