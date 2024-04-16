import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { CTokenMock } from '@typechain/CTokenMock'
import { ERC20Mock } from '@typechain/ERC20Mock'
import { StaticATokenMock } from '@typechain/StaticATokenMock'
import { USDCMock } from '@typechain/USDCMock'
import { BigNumber } from 'ethers'
import { Collateral } from '../fixtures'
import { ethers } from 'hardhat'

export const mintCollaterals = async (
  owner: SignerWithAddress,
  recipients: SignerWithAddress[],
  amount: BigNumber,
  basket: Collateral[]
) => {
  const token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await basket[0].erc20())
  const token1 = <USDCMock>await ethers.getContractAt('USDCMock', await basket[1].erc20())
  const token2 = <StaticATokenMock>(
    await ethers.getContractAt('StaticATokenMock', await basket[2].erc20())
  )
  const token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await basket[3].erc20())

  for (const recipient of recipients) {
    await token0.connect(owner).mint(recipient.address, amount)

    await token1.connect(owner).mint(recipient.address, amount)

    await token2.connect(owner).mint(recipient.address, amount)

    await token3.connect(owner).mint(recipient.address, amount)
  }
}
