import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { networkConfig } from '#/common/configuration'
import { whileImpersonating } from '#/utils/impersonation'
import axios from "axios";
import * as cheerio from "cheerio";

async function main() {
  const chainId = await getChainId(hre)

  // ********** Read config **********
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const tokenAddress = networkConfig[chainId].tokens.RSR!

  const ethUrl = `https://etherscan.io/token/generic-tokenholders2?m=light&a=${tokenAddress}&p=1`

  const response = await axios.get(ethUrl);
  const selector = cheerio.load(response.data);
  // TODO: make sure that the selector is ok to use
  //    example: if the token is RSR, we don't want an stRSR to be the whale
  const bigWhale = selector(selector("tbody > tr")[0]).find("td > div > .link-secondary")[0].attribs['data-clipboard-text'];
  console.log(bigWhale)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })