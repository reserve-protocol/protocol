import { task } from 'hardhat/config'
import { Tally } from '@withtally/tally-publish-dao/src/tally'
import { getChainId } from '../../../common/blockchain-utils'

task('publish-dao')
  .addParam('governor', 'Governor address')
  .addParam('token', 'Governance token address')
  .setAction(async (params, hre) => {
    const tally = (hre as any).tally as Tally

    console.log('tally', tally)

    const chainId = await getChainId(hre)

    await tally.publishDao({
      name: 'My DAO',
      contracts: {
        governor: {
          address: params.governor,
          type: 'OPENZEPPELINGOVERNOR',
        },
        token: {
          address: params.token,
          type: 'ERC20',
        },
      },
    })

    if (!params.noOutput) {
      console.log(`Published DAO to ${hre.network.name} (${chainId}): ${params.governor}`)
    }
  })
