import { task, types } from 'hardhat/config'

task('sign-msg', 'Signs a message from a wallet')
  .addParam('msg', 'The text of the message to sign')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    if (!params.noOutput) {
      console.log(`Signing message "${params.msg}" from burner account ${wallet.address}`)
    }

    const signedMsg = await wallet.signMessage(params.msg)

    if (!params.noOutput) {
      console.log('Signed Message:')
      console.log(signedMsg)
    }
  })
