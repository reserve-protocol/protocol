import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'

task('empty-wallet', 'Transfers all ETH out of the wallet')
  .addParam('recipient', 'To whom the ETH should go')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Emptying wallet on ${hre.network.name} (${chainId}) for burner account ${wallet.address}`
      )
    }

    const bal = await wallet.getBalance()
    const gasPrice = await wallet.getGasPrice()
    if (!bal.gt(gasPrice.mul(21000))) {
      throw new Error('Balance less than cost of transfer')
    }
    const tx = {
      value: bal.sub(gasPrice.mul(21000)),
      to: params.recipient,
      gasPrice: gasPrice,
    }
    await wallet.sendTransaction(tx)

    if (!params.noOutput) {
      console.log(`Withdrew ${tx.value} on ${hre.network.name} (${chainId}) to ${params.recipient}`)
    }
  })
