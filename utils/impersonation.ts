import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

type ImpersonationFunction<T> = (signer: SignerWithAddress) => Promise<T>

/* whileImpersonating(address, f):

   Set up `signer` to be an ethers transaction signer that impersonates the account address
   `address`. In that context, call f(signer). `address` can be either a contract address or an
   external account, so you can use often this instead of building entire mock contracts.

   Example usage:

   await whileImpersonating(basketHandler.address, async (signer) => {
     await expect(rToken.connect(signer).setBasketsNeeded(fp('1'))
     .to.emit(rToken, 'BasketsNeededChanged')
   })

   This does the following:
   - Sets the basketHandler Eth balance to 2^256-1 (so it has plenty of gas)
   - Calls rToken.setBasketsNeeded _as_ the basketHandler contract,
   - Checks that that call emits the event 'BasketNeededChanged'
*/
export const whileImpersonating = async (
  hre: HardhatRuntimeEnvironment,
  address: string,
  f: ImpersonationFunction<void>
) => {
  // Set maximum ether balance at address
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [address, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
  })
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })
  const signer = await hre.ethers.getSigner(address)

  await f(signer)

  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  })
  // If anyone ever needs it, we could make sure here that we set the balance at address back to
  // its original quantity...
}
