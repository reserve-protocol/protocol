import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

type ImpersonationFunction = (signer: SignerWithAddress) => Promise<any>
export const whileImpersonating = async (address: string, f: ImpersonationFunction) => {
  // Set maximum ether balance at address

  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [address, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
  })
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })
  const signer = await ethers.getSigner(address)

  await f(signer)

  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  })
}
