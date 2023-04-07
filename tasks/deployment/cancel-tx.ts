import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'

task('cancel-tx', 'Sends a replacement tx at a nonce')
  .addParam('nonce', 'The nonce of the tx to cancel')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Sending empty replacement tx on ${hre.network.name} (${chainId}) for burner account ${wallet.address}`
      )
    }

    // const gasPrice = await wallet.getGasPrice()
    const reserveEngWallet = '0x36F31f122fF37EBEe35F1264bEE39Aa14Fd7C01b'
    const tx = {
      value: 1,
      to: reserveEngWallet,
      nonce: params.nonce,
    }
    await wallet.sendTransaction(tx)

    if (!params.noOutput) {
      console.log(`Withdrew ${tx.value} on ${hre.network.name} (${chainId}) to ${reserveEngWallet}`)
    }
  })
