import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { Contract } from 'ethers'
import { parseEther, parseUnits } from 'ethers/lib/utils'
import { ethers } from 'hardhat'

import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ORACLE_ERROR,
  CHAINLINK_ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
  MIDAS_ORACLE_TIMEOUT,
} from './constants'
import { MidasAggregatorV3Abi } from './midasAggregator'

import { DefaultFixture, getDefaultFixture, Fixture } from '../fixtures'

import { whileImpersonating } from '#/test/utils/impersonation'
import {
  AccessControlUpgradeable,
  IMidasDataFeed,
  IMToken,
  MidasCollateral,
  MockV3Aggregator,
} from '#/typechain'

export interface MBTCFixtureContext extends DefaultFixture {
  mToken: IMToken
  accessControl: AccessControlUpgradeable
  mbtcCollateral: MidasCollateral
  mockBtcAgg: MockV3Aggregator
  midasAggregator: Contract
  midasDataFeed: IMidasDataFeed
  INITIAL_BTC_PRICE: number
  MTOKEN_ADMIN_ADDRESS: string
}

const MBTC_ADDRESS = '0x007115416AB6c266329a03B09a8aa39aC2eF7d9d'
const MTOKEN_ADMIN_ADDRESS = '0x875c06A295C41c27840b9C9dfDA7f3d819d8bC6A'
const BTC_MBTC_MIDAS_AGGREGATOR_ADDRESS = '0xA537EF0343e83761ED42B8E017a1e495c9a189Ee'
const BTC_MBTC_MIDAS_FEED_ADDRESS = '0x9987BE0c1dc5Cd284a4D766f4B5feB4F3cb3E28e'

export const deployMBTCCollateralFixture: Fixture<MBTCFixtureContext> = async function () {
  const ctx = await loadFixture(await getDefaultFixture('mbtc-salt'))

  const mToken = await ethers.getContractAt('IMToken', MBTC_ADDRESS)

  const accessControlAddress = await mToken.accessControl()
  const accessControl = await ethers.getContractAt('AccessControlUpgradeable', accessControlAddress)

  const INITIAL_BTC_PRICE = 100_000 * 1e8 // Set initial USD/BTC price to 100k USD per BTC
  const INITIAL_MBTC_PRICE = parseUnits('1', 8) // Set initial BTC/mBTC price to 1 BTC per mBTC

  // Deploy a mock chainlink aggregator for USD/BTC
  const MockV3AggFactory = await ethers.getContractFactory('MockV3Aggregator')
  const mockBtcAgg = await MockV3AggFactory.deploy(8, INITIAL_BTC_PRICE.toString())
  await mockBtcAgg.deployed()

  const midasAggregator = await ethers.getContractAt(
    MidasAggregatorV3Abi,
    BTC_MBTC_MIDAS_AGGREGATOR_ADDRESS
  )

  await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
    const role = await midasAggregator.feedAdminRole()
    const hasRole = await accessControl.hasRole(role, adminSigner.address)

    if (!hasRole) {
      await accessControl.connect(adminSigner).grantRole(role, adminSigner.address)
    }
    await midasAggregator.connect(adminSigner).setRoundData(INITIAL_MBTC_PRICE)
  })
  const midasDataFeed = await ethers.getContractAt('IMidasDataFeed', BTC_MBTC_MIDAS_FEED_ADDRESS)

  const config = {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: mockBtcAgg.address,
    oracleError: ORACLE_ERROR,
    erc20: MBTC_ADDRESS,
    maxTradeVolume: parseEther('1000000'),
    oracleTimeout: CHAINLINK_ORACLE_TIMEOUT,
    targetName: ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
  }

  const MidasCollateralFactory = await ethers.getContractFactory('MidasCollateral')
  const mbtcCollateral = await MidasCollateralFactory.deploy(
    config,
    REVENUE_HIDING,
    BTC_MBTC_MIDAS_FEED_ADDRESS,
    MIDAS_ORACLE_TIMEOUT
  )

  await mbtcCollateral.deployed()

  return {
    ...ctx,
    mToken,
    accessControl,
    mbtcCollateral,
    mockBtcAgg,
    midasAggregator,
    midasDataFeed,
    INITIAL_BTC_PRICE,
    MTOKEN_ADMIN_ADDRESS,
    BTC_MBTC_MIDAS_FEED_ADDRESS,
  }
}
