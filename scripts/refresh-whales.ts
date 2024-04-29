import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { ITokens, networkConfig } from '#/common/configuration'
import { whileImpersonating } from '#/utils/impersonation'
import axios from "axios";
import * as cheerio from "cheerio";
const whales = require("../tasks/validation/whales.json")
import fs from "fs"

interface Whales extends ITokens {}

interface WhaleNetworkConfig {
    name: string
    tokens: Whales
}

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
    selector(selector("tbody > tr")[0]).find("td > div > .link-secondary")[0].attribs['data-clipboard-text'];
  }

  const tokenWales = {}

  for (let i = 0; i < tokens.length; i++) {
    console.log('Getting whale for', tokens[i])
    const bigWhale = await getBigWhale(networkConfig[chainId].tokens[tokens[i]])
    tokenWales[tokens[i]] = bigWhale
  }

  tokenWales[chainId].tokens = tokenWales
  fs.writeFileSync("../tasks/validation/whales.json", JSON.stringify(tokenWales, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })