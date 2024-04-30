import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { ITokens, networkConfig } from '#/common/configuration'
import { whileImpersonating } from '#/utils/impersonation'
import axios from "axios";
import * as cheerio from "cheerio";
import { NetworkWhales, getWhalesFile } from './whalesConfig';
import fs from 'fs'

async function main() {
  const chainId = await getChainId(hre)

  // ********** Read config **********
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const tokens = Object.keys(networkConfig[chainId].tokens)

  const getBigWhale = async (token: string) => {
    const ethUrl = `https://etherscan.io/token/generic-tokenholders2?m=light&a=${token}&p=1`
    const response = await axios.get(ethUrl);
    const selector = cheerio.load(response.data);
    // TODO: make sure that the selector is ok to use
    //    example: if the token is RSR, we don't want an stRSR to be the whale
    return selector(selector("tbody > tr")[0]).find("td > div > .link-secondary")[0].attribs['data-clipboard-text'];
  }

  const whales: NetworkWhales = getWhalesFile(chainId)

  for (let i = 0; i < tokens.length; i++) {
    let tokenAddress = networkConfig[chainId].tokens[tokens[i]].toLowerCase()
    let tokenWhale = whales.tokens[tokens[i]]
    let lastUpdated = whales.lastUpdated[tokens[i]]
    // only get a big whale if the whale is not already set or if it was last updated more than 1 day ago
    if (tokenWhale && lastUpdated && new Date().getTime() - new Date(lastUpdated).getTime() < 86400000) {
      console.log('Whale already set for', tokens[i], 'skipping...')
      continue
    }
    console.log('Getting whale for', tokens[i])
    try {
      const bigWhale = await getBigWhale(tokenAddress)
      whales.tokens[tokens[i]] = bigWhale
      whales.lastUpdated[tokens[i]] = new Date().toISOString()
      fs.writeFileSync(whalesFile, JSON.stringify(whales, null, 2))
      console.log('Whale updated for', tokens[i])
    } catch (error) {
      console.error('Error getting whale for', tokens[i], error)
    }
  }

  console.log('All whales updated for network', chainId)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })