import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { ITokens, ITokensKeys, networkConfig } from '#/common/configuration'
import { whileImpersonating } from '#/utils/impersonation'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { NetworkWhales, RTOKENS, getWhalesFile, getWhalesFileName } from './whalesConfig'
import fs from 'fs'
import { useEnv } from '#/utils/env'

// set to true to force a refresh of all whales
const FORCE_REFRESH = useEnv('FORCE_WHALE_REFRESH')
const BASESCAN_API_KEY = useEnv('BASESCAN_API_KEY')
const FORK_NETWORK = useEnv('FORK_NETWORK')

const SCANNER_URLS: { [key: string]: string } = {
  mainnet: 'etherscan.io',
  base: 'basescan.org',
}

const getstRSRs = async (rTokens: string[]) => {
  const strsrs: string[] = []
  for (let i = 0; i < rTokens.length; i++) {
    const rToken = rTokens[i]
    const rTokenContract = await hre.ethers.getContractAt('RTokenP1', rToken)
    // lazy way to skip rtokens that are bridged
    try {
      const mainAddress = await rTokenContract.main()
      const main = await hre.ethers.getContractAt('IMain', mainAddress)
      strsrs.push(await main.stRSR())
    } catch {}
  }
  return strsrs
}

async function main() {
  const chainId = await getChainId(hre)

  // ********** Read config **********
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }
  console.log('Refreshing whales for network', chainId, hre.network.name, FORK_NETWORK)

  const rTokens = RTOKENS[chainId]
  const stRSRs = await getstRSRs(rTokens)

  const whalesFile = getWhalesFileName(chainId)
  const whales: NetworkWhales = getWhalesFile(chainId)

  const isGoodWhale = (whale: string) => {
    return !stRSRs.includes(whale)
  }

  const getBigWhale = async (token: string) => {
    const ethUrl = `https://${SCANNER_URLS[FORK_NETWORK]}/token/generic-tokenholders2?m=light&a=${token}&p=1`
    // const response = await axios.get(ethUrl);

    if (FORK_NETWORK === 'mainnet') {
      const response = await axios.get(ethUrl)
      const selector = cheerio.load(response.data)
      let found = false
      let i = 0
      let whale = ''
      while (!found) {
        whale = selector(selector('tbody > tr')[i]).find('td > div > .link-secondary')[0].attribs[
          'data-clipboard-text'
        ]
        if (isGoodWhale(whale)) {
          found = true
          break
        }
        i++
      }
      return whale
    } else if (FORK_NETWORK === 'base') {
      const response = await fetch(ethUrl, {
        headers: {
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'max-age=0',
          priority: 'u=0, i',
          'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
        },
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: null,
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
      })
      const selector = cheerio.load(await response.text())
      let found = false
      let i = 0
      let whale = ''
      while (!found) {
        whale = selector(selector('tbody > tr')[i])
          .find('td > span > a')[0]
          .attribs['href'].split('?a=')[1]
        if (isGoodWhale(whale)) {
          found = true
          break
        }
        i++
      }
      return whale
    } else {
      throw new Error('Invalid network')
    }
    // TODO: make sure that the selector is ok to use
    //    example: if the token is RSR, we don't want an stRSR to be the whale
  }

  const refreshWhale = async (tokenAddress: string) => {
    let tokenWhale = whales.tokens[tokenAddress]
    let lastUpdated = whales.lastUpdated[tokenAddress]
    // only get a big whale if the whale is not already set or if it was last updated more than 1 day ago
    if (
      !FORCE_REFRESH &&
      tokenWhale &&
      lastUpdated &&
      new Date().getTime() - new Date(lastUpdated).getTime() < 86400000
    ) {
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
      console.log(`Whale ${bigWhale} updated for`, tokenAddress)
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
