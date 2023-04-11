import { task } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { fp } from '#/common/numbers'
import { whileImpersonating } from '#/utils/impersonation'

task('give-eth', 'Mints ETH to an address on a tenderly fork')
  .addParam('address', 'Ethereum address to receive the tokens')
  .addParam('rpc', 'The Tenderly RPC endpoint')
  .setAction(async (params, hre) => {
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

    console.log(`10 ETH sent to ${params.address}`)
  })

task('give-rsr-tenderly', 'Mints RSR to an address on a tenderly fork')
  .addParam('address', 'Ethereum address to receive the tokens')
  .addParam('rpc', 'The Tenderly RPC endpoint')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    const rsr = await hre.ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.RSR!)

    const unsignedTx = await rsr.populateTransaction['transfer'](params.address, fp('100e6'))
    const rsrWhale = "0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1"
    const transactionParameters = [{
        to: rsr.address,
        from: rsrWhale,
        data: unsignedTx.data,
        gas: hre.ethers.utils.hexValue(300000),
        gasPrice: hre.ethers.utils.hexValue(1),
        value: hre.ethers.utils.hexValue(0)
    }];

    const forkProvider = new hre.ethers.providers.JsonRpcProvider(params.rpc);

    await forkProvider.send('tenderly_setBalance', [
        [rsrWhale],
        hre.ethers.utils.hexValue(hre.ethers.utils.parseUnits('1', 'ether').toHexString()),
    ]);

    const txHash = await forkProvider.send('eth_sendTransaction', transactionParameters)

    console.log(`100m RSR sent to ${params.address}`)
  })