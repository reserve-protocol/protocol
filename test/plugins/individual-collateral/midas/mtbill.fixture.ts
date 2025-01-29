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
import { AccessControlUpgradeable, IMidasDataFeed, IMToken, MidasCollateral } from '#/typechain'

export interface MTBILLFixtureContext extends DefaultFixture {
  mToken: IMToken
  accessControl: AccessControlUpgradeable
  mtbillCollateral: MidasCollateral
  midasAggregator: Contract
  midasDataFeed: IMidasDataFeed
  MTOKEN_ADMIN_ADDRESS: string
}

const MTBILL_ADDRESS = '0xDD629E5241CbC5919847783e6C96B2De4754e438'
const MTOKEN_ADMIN_ADDRESS = '0x875c06A295C41c27840b9C9dfDA7f3d819d8bC6A'
const USD_MTBILL_MIDAS_AGGREGATOR_ADDRESS = '0x056339C044055819E8Db84E71f5f2E1F536b2E5b'
const USD_MTBILL_MIDAS_FEED_ADDRESS = '0xfCEE9754E8C375e145303b7cE7BEca3201734A2B'
const USD_USDC_CHAINLINK_FEED_ADDRESS = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'

export const deployMTBILLCollateralFixture: Fixture<MTBILLFixtureContext> = async function () {
  const ctx = await loadFixture(await getDefaultFixture('mtbill-salt'))

  const mToken = await ethers.getContractAt('IMToken', MTBILL_ADDRESS)

  const accessControlAddress = await mToken.accessControl()
  const accessControl = await ethers.getContractAt('AccessControlUpgradeable', accessControlAddress)

  const INITIAL_MTBILL_PRICE = parseUnits('1', 8) // Set initial USD/mTBILL price to 1 USD per mTBILL

  const midasAggregator = await ethers.getContractAt(
    MidasAggregatorV3Abi,
    USD_MTBILL_MIDAS_AGGREGATOR_ADDRESS
  )

  await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
    const role = await midasAggregator.feedAdminRole()
    const hasRole = await accessControl.hasRole(role, adminSigner.address)

    if (!hasRole) {
      await accessControl.connect(adminSigner).grantRole(role, adminSigner.address)
    }
    await midasAggregator.connect(adminSigner).setRoundData(INITIAL_MTBILL_PRICE)
  })
  const midasDataFeed = await ethers.getContractAt('IMidasDataFeed', USD_MTBILL_MIDAS_FEED_ADDRESS)

  const config = {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: USD_USDC_CHAINLINK_FEED_ADDRESS, // AppreciatingFiatCollateral.sol -> Feed units: {UoA/ref}
    oracleError: ORACLE_ERROR,
    erc20: MTBILL_ADDRESS,
    maxTradeVolume: parseEther('1000000'),
    oracleTimeout: CHAINLINK_ORACLE_TIMEOUT,
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
  }

  const MidasCollateralFactory = await ethers.getContractFactory('MidasCollateral')
  const mtbillCollateral = await MidasCollateralFactory.deploy(
    config,
    REVENUE_HIDING,
    USD_MTBILL_MIDAS_FEED_ADDRESS,
    MIDAS_ORACLE_TIMEOUT
  )

  await mtbillCollateral.deployed()

  return {
    ...ctx,
    mToken,
    accessControl,
    mtbillCollateral,
    midasAggregator,
    midasDataFeed,
    MTOKEN_ADMIN_ADDRESS,
  }
}
