import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../common/configuration'
import { sh } from './deployment/utils'
import FolioArtifact from './Folio.json'
import { whileImpersonating } from '#/utils/impersonation'
import { bn } from '#/common/numbers'
import { getLatestBlockTimestamp, setNextBlockTimestamp } from '#/utils/time'

async function main() {
  const [deployer] = await hre.ethers.getSigners()
  const abi = FolioArtifact.abi
  const VTF_ADDRESS = '0x47686106181b3cefe4eaf94c4c10b48ac750370b'
  const AUCTION_LAUNCHER = '0x93db2e90f8b2b073010b425f9350202330bd923e'
  const folio = new hre.ethers.Contract(VTF_ADDRESS, abi, deployer)

  const auctionId = 1
  const sellLimit = 0
  const buyLimit = bn('33825134838222553606000000')
  const startPrice = bn('20390832831556446506000000')
  const endPrice = bn('16516574593560721670000000')

  await whileImpersonating(hre, AUCTION_LAUNCHER, async (signer) => {
    const tx = await folio
      .connect(signer)
      .openAuction(auctionId, sellLimit, buyLimit, startPrice, endPrice)
    await tx.wait()
    console.log('Auction launched')
  })

  const startTimestamp = await getLatestBlockTimestamp(hre)
  const endTimestamp = startTimestamp + 60 * 30

  for (let i = 1; i < 30; i++) {
    let timestamp = startTimestamp + i * 60 // 1 minute increments
    const lot = await folio.log(auctionId, timestamp)
    console.log(`Lot ${lot}, minutes ${i}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
