import { ERC20Mock } from '@typechain/ERC20Mock'
import {
  IAeroPool,
  IAeroGauge,
  AerodromeGaugeWrapper__factory,
  AerodromeGaugeWrapper,
  TestICollateral,
  MockV3Aggregator,
} from '@typechain/index'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import {
  USDC,
  eUSD,
  AERO,
  AERO_USDC_eUSD_POOL,
  AERO_USDC_eUSD_GAUGE,
  FORK_BLOCK,
} from './constants'
import { getResetFork } from '../helpers'
import { pushOracleForward } from '../../../utils/oracles'
import { whileImpersonating } from '#/test/utils/impersonation'
import { ZERO_ADDRESS } from '#/common/constants'

interface WrappedAeroFixture {
  token0: ERC20Mock
  token1: ERC20Mock
  wrapper: AerodromeGaugeWrapper
  lpToken: IAeroPool
}

export const makeWUSDCeUSD = async (sAMM_usdc_eUSD?: string): Promise<WrappedAeroFixture> => {
  const lpToken = <IAeroPool>(
    await ethers.getContractAt('IAeroPool', sAMM_usdc_eUSD ?? AERO_USDC_eUSD_POOL)
  )

  const AerodromGaugeWrapperFactory = <AerodromeGaugeWrapper__factory>(
    await ethers.getContractFactory('AerodromeGaugeWrapper')
  )

  const wrapper = await AerodromGaugeWrapperFactory.deploy(
    lpToken.address,
    'w' + (await lpToken.name()),
    'w' + (await lpToken.symbol()),
    AERO,
    AERO_USDC_eUSD_GAUGE
  )
  const token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
  const token1 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', eUSD)

  return { token0, token1, wrapper, lpToken }
}

export const mintLpToken = async (
  gauge: IAeroGauge,
  lpToken: IAeroPool,
  amount: BigNumberish,
  holder: string,
  recipient: string
) => {
  await whileImpersonating(holder, async (signer) => {
    // holder can have lpToken OR gauge
    if ((await lpToken.balanceOf(signer.address)).lt(amount)) {
      await gauge.connect(signer).withdraw(amount)
    }
    await lpToken.connect(signer).transfer(recipient, amount)
  })
}

export const mintWrappedLpToken = async (
  wrapper: AerodromeGaugeWrapper,
  gauge: IAeroGauge,
  lpToken: IAeroPool,
  amount: BigNumberish,
  holder: string,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintLpToken(gauge, lpToken, amount, holder, user.address)
  await lpToken.connect(user).approve(wrapper.address, ethers.constants.MaxUint256)
  await wrapper.connect(user).deposit(amount, recipient)
}

export const getFeeds = async (coll: TestICollateral): Promise<MockV3Aggregator[]> => {
  const aeroColl = await ethers.getContractAt('AerodromeVolatileCollateral', coll.address)
  // works for AerodromeStableCollateral too

  const feedAddrs = (await aeroColl.tokenFeeds(0)).concat(await aeroColl.tokenFeeds(1))
  const feeds: MockV3Aggregator[] = []

  for (const feedAddr of feedAddrs) {
    if (feedAddr != ZERO_ADDRESS) {
      const oracle = await ethers.getContractAt('MockV3Aggregator', feedAddr)
      feeds.push(oracle)
    }
  }

  return feeds
}

export const pushAllFeedsForward = async (coll: TestICollateral) => {
  const feeds = await getFeeds(coll)
  for (const oracle of feeds) {
    await pushOracleForward(oracle.address)
  }
}

export const resetFork = getResetFork(FORK_BLOCK)
