/* eslint-disable no-empty */
import { networkConfig } from '../../../common/configuration'
import { EACAggregatorProxyMock } from '@typechain/EACAggregatorProxyMock'
import { GenericOracleMock } from '@typechain/GenericOracleMock'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BigNumber } from 'ethers'
import { AggregatorV3Interface } from '@typechain/index'
import { ONE_ADDRESS } from '../../../common/constants'
import { MAINNET_DEPLOYMENTS, BASE_DEPLOYMENTS, RTokenDeployment } from './constants'

export const overrideOracle = async (
  hre: HardhatRuntimeEnvironment,
  oracleAddress: string
): Promise<EACAggregatorProxyMock> => {
  const oracle = await hre.ethers.getContractAt(
    'contracts/plugins/mocks/EACAggregatorProxyMock.sol:EACAggregatorProxy',
    oracleAddress
  )
  const aggregator = await oracle.aggregator()
  const accessController = await oracle.accessController()
  const initPrice = await oracle.latestRoundData()
  const mockOracleFactory = await hre.ethers.getContractFactory('EACAggregatorProxyMock')
  const mockOracle = await mockOracleFactory.deploy(aggregator, accessController, initPrice.answer)
  const bytecode = await hre.network.provider.send('eth_getCode', [mockOracle.address, 'latest'])
  await hre.network.provider.request({
    method: 'hardhat_setCode',
    params: [oracleAddress, bytecode],
  })
  return hre.ethers.getContractAt('EACAggregatorProxyMock', oracleAddress)
}

export const overrideGenericOracle = async (
  hre: HardhatRuntimeEnvironment,
  oracleAddress: string
): Promise<GenericOracleMock> => {
  const oracle = await hre.ethers.getContractAt('AggregatorV3Interface', oracleAddress)
  const decimals = await oracle.decimals()
  const initPrice = await oracle.latestRoundData()
  const mockOracleFactory = await hre.ethers.getContractFactory('GenericOracleMock')
  const mockOracle = await mockOracleFactory.deploy(decimals, initPrice.answer)
  const bytecode = await hre.network.provider.send('eth_getCode', [mockOracle.address, 'latest'])
  await hre.network.provider.request({
    method: 'hardhat_setCode',
    params: [oracleAddress, bytecode],
  })

  // Initialize mock oracle
  const genericOracle = await hre.ethers.getContractAt('GenericOracleMock', oracleAddress)
  await genericOracle.initialize(decimals, initPrice.answer)

  return genericOracle
}

export const pushOraclesForward = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  extraAssets: string[] = []
) => {
  console.log(`🔃 Pushing Oracles forward for RToken: ${rTokenAddress}`)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const registry = await assetRegistry.getRegistry()

  let addresses: string[] = [] // hacky way to ensure only unique updates to save time
  for (const asset of registry.assets) {
    addresses = await pushOracleForward(hre, asset, addresses)
  }

  for (const asset of extraAssets) {
    await pushOracleForward(hre, asset, addresses)
  }
}

export const pushOracleForward = async (
  hre: HardhatRuntimeEnvironment,
  asset: string,
  addresses: string[]
): Promise<string[]> => {
  // Need to handle all oracle cases, ie targetUnitChainlinkFeed, PoolTokens, etc
  const updateAnswer = async (chainlinkFeed: AggregatorV3Interface) => {
    if (addresses.indexOf(chainlinkFeed.address) != -1) return

    const initPrice = await chainlinkFeed.latestRoundData()
    let oracle: EACAggregatorProxyMock | GenericOracleMock

    try {
      // Try Chainlink (EACAggregatorProxy) first
      oracle = await overrideOracle(hre, chainlinkFeed.address)
    } catch (e) {
      // If Chainlink fails, try Generic oracle (works for Redstone)
      console.log(`⚠️  Chainlink mock failed for ${chainlinkFeed.address}, trying generic...`)
      oracle = await overrideGenericOracle(hre, chainlinkFeed.address)
    }

    await oracle.updateAnswer(initPrice.answer)
    addresses.push(chainlinkFeed.address)
    console.log('✅ Feed Updated:', chainlinkFeed.address)
  }

  // chainlinkFeed
  try {
    const assetContract = await hre.ethers.getContractAt('TestIAsset', asset)
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContract.chainlinkFeed()
    )
    if (feed.address != ONE_ADDRESS) await updateAnswer(feed)
  } catch {
    // console.error('❌ chainlinkFeed not found for:', asset, 'skipping...')
  }

  // targetUnitChainlinkFeed
  try {
    const assetContractNonFiat = await hre.ethers.getContractAt('NonFiatCollateral', asset)
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractNonFiat.targetUnitChainlinkFeed()
    )
    await updateAnswer(feed)
  } catch {
    // console.error('❌ targetUnitChainlinkFeed not found for:', asset, 'skipping...')
  }

  // targetPerRefChainlinkFeed, uoaPerTargetChainlinkFeed, refPerTokenChainlinkFeed
  try {
    const assetContractLido = await hre.ethers.getContractAt('L2LSDCollateral', asset)
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractLido.exchangeRateChainlinkFeed()
    )
    await updateAnswer(feed)
  } catch {
    // console.error('❌ exchangeRateChainlinkFeed not found for:', asset, 'skipping...')
  }

  // targetPerRefChainlinkFeed, uoaPerTargetChainlinkFeed, refPerTokenChainlinkFeed
  try {
    const assetContractLido = await hre.ethers.getContractAt('L2LidoStakedEthCollateral', asset)
    let feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractLido.targetPerRefChainlinkFeed()
    )
    await updateAnswer(feed)
    feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractLido.uoaPerTargetChainlinkFeed()
    )
    await updateAnswer(feed)
    feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractLido.refPerTokenChainlinkFeed()
    )
    await updateAnswer(feed)
    feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractLido.exchangeRateChainlinkFeed()
    )
    await updateAnswer(feed)
  } catch {
    // console.error('❌ targetPerRefChainlinkFeed, uoaPerTargetChainlinkFeed, or refPerTokenChainlinkFeed not found for:', asset, 'skipping...')
  }

  // targetPerTokChainlinkFeed
  try {
    const assetContractReth = await hre.ethers.getContractAt('RethCollateral', asset)
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContractReth.targetPerTokChainlinkFeed()
    )
    await updateAnswer(feed)
  } catch {
    // console.error('❌ targetPerTokChainlinkFeed not found for:', asset, 'skipping...')
  }

  // Dealing with nested RTokens
  // TODO do better

  // eUSDFRAXBP
  if (
    asset == '0x890FAa00C16EAD6AA76F18A1A7fe9C40838F9122' ||
    asset == '0x5cD176b58a6FdBAa1aEFD0921935a730C62f03Ac' ||
    asset == '0x994455cE66Fd984e2A0A0aca453e637810a8f032' ||
    asset == '0x875af0Bab943b7416c6D2142546cAb61F1Ad964a'
  ) {
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      networkConfig['1'].chainlinkFeeds.FRAX!
    )
    await updateAnswer(feed)
    const eUSDAssetRegistry = await hre.ethers.getContractAt(
      'IAssetRegistry',
      '0x9B85aC04A09c8C813c37de9B3d563C2D3F936162'
    )
    const [, eUSDAssets] = await eUSDAssetRegistry.getRegistry()
    for (const eUSDAsset of eUSDAssets) {
      addresses = await pushOracleForward(hre, eUSDAsset, addresses) // recursion!
    }
  }

  // Convex ETH+/ETH (Nested RToken)
  if (
    asset == '0x05F164E71C46a8f8FB2ba71550a00eeC9FCd85cd' ||
    asset == '0xfa025df685BA0A09B2C767f4Cc1a1972F140d421'
  ) {
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      networkConfig['1'].chainlinkFeeds.ETH!
    )
    await updateAnswer(feed)
    const ethplusAssetRegistry = await hre.ethers.getContractAt(
      'IAssetRegistry',
      '0xf526f058858E4cD060cFDD775077999562b31bE0'
    )
    const [, ethplusAssets] = await ethplusAssetRegistry.getRegistry()
    for (const ethplusAsset of ethplusAssets) {
      addresses = await pushOracleForward(hre, ethplusAsset, addresses) // recursion!
    }
  }

  // Aerodrome Pools (Base)
  if (
    asset == '0x9216CD5cA133aBBd23cc6F873bB4a95A78032db0' ||
    asset == '0x1cCa3FBB11C4b734183f997679d52DeFA74b613A' ||
    asset == '0x97F9d5ed17A0C99B279887caD5254d15fb1B619B'
  ) {
    const aeroPoolTokens = await hre.ethers.getContractAt('AerodromePoolTokens', asset)
    const feed0 = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      (
        await aeroPoolTokens.tokenFeeds(0)
      )[0]
    )
    await updateAnswer(feed0)

    const feed1 = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      (
        await aeroPoolTokens.tokenFeeds(1)
      )[0]
    )
    await updateAnswer(feed1)
  }

  return addresses
}

export const setOraclePrice = async (
  hre: HardhatRuntimeEnvironment,
  asset: string,
  value: BigNumber
) => {
  const assetContract = await hre.ethers.getContractAt('TestIAsset', asset)
  const realChainlinkFeed = await hre.ethers.getContractAt(
    'AggregatorV3Interface',
    await assetContract.chainlinkFeed()
  )

  let oracle: EACAggregatorProxyMock | GenericOracleMock
  try {
    // Try Chainlink (EACAggregatorProxy) first
    oracle = await overrideOracle(hre, realChainlinkFeed.address)
  } catch (e) {
    // If Chainlink fails, try generic oracle (compatible with Redstone)
    oracle = await overrideGenericOracle(hre, realChainlinkFeed.address)
  }

  await oracle.updateAnswer(value)
}

export const getRTokenOracle = (rTokenAddress: string): string | undefined => {
  const allDeployments: RTokenDeployment[] = [...MAINNET_DEPLOYMENTS, ...BASE_DEPLOYMENTS]
  const deployment = allDeployments.find(
    (d) => d.rToken.toLowerCase() === rTokenAddress.toLowerCase()
  )
  return deployment?.oracle
}

export const getRTokenOraclePrice = async (
  hre: HardhatRuntimeEnvironment,
  oracleAddress: string
): Promise<BigNumber> => {
  const oracle = await hre.ethers.getContractAt('AggregatorV3Interface', oracleAddress)
  const roundData = await oracle.latestRoundData()
  return roundData.answer
}

export const validateRTokenOraclePriceChange = (
  priceBefore: BigNumber,
  priceAfter: BigNumber,
  rTokenAddress: string
): void => {
  if (priceBefore.isZero()) {
    throw new Error(`Invalid price for RToken ${rTokenAddress}`)
  }

  // Check price is within 0.1% range
  const lowerBound = priceBefore.mul(999).div(1000)
  const upperBound = priceBefore.mul(1001).div(1000)

  if (priceAfter.lt(lowerBound) || priceAfter.gt(upperBound)) {
    throw new Error(
      `RToken Oracle price outside allowed 0.1% range.\n` +
        `  Price before: ${priceBefore.toString()}\n` +
        `  Price after: ${priceAfter.toString()}\n` +
        `  Allowed range: ${lowerBound.toString()} - ${upperBound.toString()}\n` +
        `  RToken: ${rTokenAddress}`
    )
  }

  console.log(`✅ RToken Oracle price validation passed!\n`)
}
