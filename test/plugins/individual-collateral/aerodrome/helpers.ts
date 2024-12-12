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
  FORK_BLOCK,
  USDC_USD_FEED,
  USDC_HOLDER,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  AERO_USDC_eUSD_POOL,
  AERO_USDC_eUSD_GAUGE,
  AERO_USDC_eUSD_HOLDER,
  AERO_USDz_USDC_POOL,
  AERO_USDz_USDC_GAUGE,
  AERO_USDz_USDC_HOLDER,
  USDz,
  eUSD_HOLDER,
  eUSD_USD_FEED,
  eUSD_ORACLE_ERROR,
  eUSD_ORACLE_TIMEOUT,
  USDz_HOLDER,
  USDz_USD_FEED,
  USDz_ORACLE_ERROR,
  USDz_ORACLE_TIMEOUT,
  ORACLE_ERROR,
  PRICE_TIMEOUT,
} from './constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { bn } from '#/common/numbers'
import { BigNumberish, BigNumber } from 'ethers'
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

export const makeWUSDzeUSDC = async (sAMM_usdz_usdc?: string): Promise<WrappedAeroFixture> => {
  const lpToken = <IAeroPool>(
    await ethers.getContractAt('IAeroPool', sAMM_usdz_usdc ?? AERO_USDz_USDC_POOL)
  )

  const AerodromGaugeWrapperFactory = <AerodromeGaugeWrapper__factory>(
    await ethers.getContractFactory('AerodromeGaugeWrapper')
  )

  const wrapper = await AerodromGaugeWrapperFactory.deploy(
    lpToken.address,
    'w' + (await lpToken.name()),
    'w' + (await lpToken.symbol()),
    AERO,
    AERO_USDz_USDC_GAUGE
  )
  const token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDz)
  const token1 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)

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

interface AeroPoolTokenConfig {
  token: string
  feeds: string[]
  oracleTimeouts: BigNumberish[]
  oracleErrors: BigNumberish[]
  holder: string
}

export interface AeroStablePoolEnumeration {
  testName: string
  pool: string
  gauge: string
  holder: string
  toleranceDivisor: BigNumber
  amountScaleDivisor?: BigNumber
  tokens: AeroPoolTokenConfig[]
  oracleTimeout: BigNumberish
  oracleError: BigNumberish
  fix: typeof makeWUSDCeUSD
}

// Test all Aerodrome Stable pools
export const allStableTests: AeroStablePoolEnumeration[] = [
  {
    testName: 'Aerodrome - USDC/eUSD Stable',
    pool: AERO_USDC_eUSD_POOL,
    gauge: AERO_USDC_eUSD_GAUGE,
    holder: AERO_USDC_eUSD_HOLDER,
    tokens: [
      {
        token: USDC,
        feeds: [USDC_USD_FEED],
        oracleTimeouts: [USDC_ORACLE_TIMEOUT],
        oracleErrors: [USDC_ORACLE_ERROR],
        holder: USDC_HOLDER,
      },
      {
        token: eUSD,
        feeds: [eUSD_USD_FEED],
        oracleTimeouts: [eUSD_ORACLE_TIMEOUT],
        oracleErrors: [eUSD_ORACLE_ERROR],
        holder: eUSD_HOLDER,
      },
    ],
    oracleTimeout: PRICE_TIMEOUT, // max
    oracleError: ORACLE_ERROR, // combined
    amountScaleDivisor: bn('1e3'),
    toleranceDivisor: bn('1e2'),
    fix: makeWUSDCeUSD,
  },
  {
    testName: 'Aerodrome - USDz/USDC Stable',
    pool: AERO_USDz_USDC_POOL,
    gauge: AERO_USDz_USDC_GAUGE,
    holder: AERO_USDz_USDC_HOLDER,
    tokens: [
      {
        token: USDz,
        feeds: [USDz_USD_FEED],
        oracleTimeouts: [USDz_ORACLE_TIMEOUT],
        oracleErrors: [USDz_ORACLE_ERROR],
        holder: USDz_HOLDER,
      },
      {
        token: USDC,
        feeds: [USDC_USD_FEED],
        oracleTimeouts: [USDC_ORACLE_TIMEOUT],
        oracleErrors: [USDC_ORACLE_ERROR],
        holder: USDC_HOLDER,
      },
    ],
    oracleTimeout: PRICE_TIMEOUT, // max
    oracleError: ORACLE_ERROR, // combined
    amountScaleDivisor: bn('1e2'),
    toleranceDivisor: bn('1e2'),
    fix: makeWUSDzeUSDC,
  },
]

export const resetFork = getResetFork(FORK_BLOCK)
