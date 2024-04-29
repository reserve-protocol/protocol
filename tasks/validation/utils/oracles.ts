/* eslint-disable no-empty */
import { networkConfig } from '../../../common/configuration'
import { EACAggregatorProxyMock } from '@typechain/EACAggregatorProxyMock'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BigNumber } from 'ethers'
import { AggregatorV3Interface } from '@typechain/index'
import { ONE_ADDRESS } from '../../../common/constants'

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

  for (const asset of registry.assets) {
    await pushOracleForward(hre, asset)
  }

  for (const asset of extraAssets) {
    await pushOracleForward(hre, asset)
  }
}

export const pushOracleForward = async (hre: HardhatRuntimeEnvironment, asset: string) => {
  // Need to handle all oracle cases, ie targetUnitChainlinkFeed, PoolTokens, etc
  const updateAnswer = async (chainlinkFeed: AggregatorV3Interface) => {
    const initPrice = await chainlinkFeed.latestRoundData()
    const oracle = await overrideOracle(hre, chainlinkFeed.address)
    await oracle.updateAnswer(initPrice.answer)

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
    console.error('❌ chainlinkFeed not found for:', asset, 'skipping...')
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
    console.error('❌ targetUnitChainlinkFeed not found for:', asset, 'skipping...')
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
  } catch {
    console.error('❌ targetPerRefChainlinkFeed, uoaPerTargetChainlinkFeed, or refPerTokenChainlinkFeed not found for:', asset, 'skipping...')
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
    console.error('❌ targetPerTokChainlinkFeed not found for:', asset, 'skipping...')
  }

  // TODO do better
  // Problem: The feeds on PoolTokens are internal immutable. Not in storage nor are there getters.
  // Workaround solution: hard-code oracles for FRAX for eUSDFRAXBP; USDC is registered as backup
  if (asset == '0x890FAa00C16EAD6AA76F18A1A7fe9C40838F9122') {
    const feed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      networkConfig['1'].chainlinkFeeds.FRAX!
    )
    await updateAnswer(feed)
  }
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
  const oracle = await overrideOracle(hre, realChainlinkFeed.address)
  await oracle.updateAnswer(value)
}
