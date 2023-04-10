import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'

task('give-eth', 'Mints all the tokens to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .addParam('rpc', 'The Tenderly RPC endpoint')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    const forkProvider = new hre.ethers.providers.JsonRpcProvider(params.rpc);

    await forkProvider.send('tenderly_setBalance', [
        [params.address],
        hre.ethers.utils.hexValue(hre.ethers.utils.parseUnits('10', 'ether').toHexString()),
    ]);
  })
