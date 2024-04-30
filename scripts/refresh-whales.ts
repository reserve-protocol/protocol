import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { ITokens, ITokensKeys, networkConfig } from '#/common/configuration'
import { whileImpersonating } from '#/utils/impersonation'
import axios from "axios";
import * as cheerio from "cheerio";
import { NetworkWhales, RTOKENS, getWhalesFile, getWhalesFileName } from './whalesConfig';
import fs from 'fs'
import { useEnv } from '#/utils/env';

// set to true to force a refresh of all whales
const FORCE_REFRESH = useEnv('FORCE_WHALE_REFRESH');

async function main() {
  const chainId = await getChainId(hre)

  // ********** Read config **********
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const whalesFile = getWhalesFileName(chainId)
  const whales: NetworkWhales = getWhalesFile(chainId)
  
  const getBigWhale = async (token: string) => {
    const ethUrl = `https://etherscan.io/token/generic-tokenholders2?m=light&a=${token}&p=1`
    const response = await axios.get(ethUrl);
    const selector = cheerio.load(response.data);
    // TODO: make sure that the selector is ok to use
    //    example: if the token is RSR, we don't want an stRSR to be the whale
    return selector(selector("tbody > tr")[0]).find("td > div > .link-secondary")[0].attribs['data-clipboard-text'];
  }

  const refreshWhale = async (tokenAddress: string) => {
    let tokenWhale = whales.tokens[tokenAddress]
    let lastUpdated = whales.lastUpdated[tokenAddress]
    // only get a big whale if the whale is not already set or if it was last updated more than 1 day ago
    if (!FORCE_REFRESH && tokenWhale && lastUpdated && new Date().getTime() - new Date(lastUpdated).getTime() < 86400000) {
      console.log('Whale already set for', tokenAddress, 'skipping...')
      return
    }
    console.log('Getting whale for', tokenAddress)
    try {
      const bigWhale = await getBigWhale(tokenAddress)
      // FIX THIS
      whales.tokens[tokenAddress] = bigWhale
      whales.lastUpdated[tokenAddress] = new Date().toISOString()
      fs.writeFileSync(whalesFile, JSON.stringify(whales, null, 2))
      console.log('Whale updated for', tokenAddress, tokenAddress)
    } catch (error) {
      console.error('Error getting whale for', tokenAddress, error)
    }
  }
  
  // ERC20 Collaterals
  const tokens: ITokensKeys = Object.keys(networkConfig[chainId].tokens) as ITokensKeys
  for (let i = 0; i < tokens.length; i++) {
    let tokenAddress = networkConfig[chainId].tokens[tokens[i]]!.toLowerCase()
    await refreshWhale(tokenAddress)
  }

  // RTokens
  const rTokens = RTOKENS[chainId]
  for (let i = 0; i < rTokens.length; i++) {
    let tokenAddress = rTokens[i]
    await refreshWhale(tokenAddress)
  }

  console.log('All whales updated for network', chainId)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })