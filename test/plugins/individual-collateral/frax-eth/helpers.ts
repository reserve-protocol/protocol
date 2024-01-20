import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IsfrxEth, IfrxEthMinter, ERC20Mock, MockV3Aggregator } from '../../../../typechain'
import { BigNumberish } from 'ethers'
import { FORK_BLOCK, FRX_ETH_MINTER } from './constants'
import { getResetFork } from '../helpers'
import { setNextBlockTimestamp, getLatestBlockTimestamp } from '../../../utils/time'
import { fp } from '#/common/numbers'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'

export const mintSfrxETH = async (
  sfrxEth: IsfrxEth,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string,
  chainlinkFeed: MockV3Aggregator
) => {
  await setBalance(account.address, fp(100000))
  const frxEthMinter: IfrxEthMinter = <IfrxEthMinter>(
    await ethers.getContractAt('IfrxEthMinter', FRX_ETH_MINTER)
  )
  const rewardCycleEnd = await sfrxEth.rewardsCycleEnd()
  const nextTimestamp = await getLatestBlockTimestamp()
  if (nextTimestamp < rewardCycleEnd) {
    await setNextBlockTimestamp(rewardCycleEnd + 1)
    await hre.network.provider.send('evm_mine', [])
  }
  // sfrx eth calculates the exchange rate via stored variables that update once per period
  // we need the reward cycle to end so that we are not subject to the linear reward unlock when minting
  const depositAmount = await sfrxEth.convertToAssets(amount)
  await frxEthMinter.connect(account).submitAndDeposit(recipient, { value: depositAmount })

  // push chainlink oracle forward so that tryPrice() still works
  const lastAnswer = await chainlinkFeed.latestRoundData()
  await chainlinkFeed.updateAnswer(lastAnswer.answer)
}

export const mintFrxETH = async (
  frxEth: ERC20Mock,
  account: SignerWithAddress,
  amount: BigNumberish,
  recipient: string
) => {
  const frxEthMinter: IfrxEthMinter = <IfrxEthMinter>(
    await ethers.getContractAt('IfrxEthMinter', FRX_ETH_MINTER)
  )
  await frxEthMinter.connect(account).submit({ value: amount })
  await frxEth.connect(account).transfer(recipient, amount)
}

export const resetFork = getResetFork(FORK_BLOCK)
