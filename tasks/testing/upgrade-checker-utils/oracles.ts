import { EACAggregatorProxyMock } from '@typechain/EACAggregatorProxyMock'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BigNumber } from 'ethers'
import { TestIAsset } from '@typechain/index'

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

export const pushOraclesForward = async (hre: HardhatRuntimeEnvironment, rTokenAddress: string) => {
  console.log(`Pushing Oracles forward for RToken ${rTokenAddress}...`)
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
}

const checkOracleExists = async (
  hre: HardhatRuntimeEnvironment,
  asset: string,
  fn: (assetContract: TestIAsset) => Promise<void>
) => {
  const assetContract = await hre.ethers.getContractAt('TestIAsset', asset)

  try {
    await assetContract.chainlinkFeed()
    console.log(`Chainlink Oracle Found. Processing asset: ${asset}`)

    await fn(assetContract)
  } catch {
    console.log(`Chainlink Oracle Missing. Skipping asset: ${asset}`)
  }
}

export const pushOracleForward = async (hre: HardhatRuntimeEnvironment, asset: string) => {
  await checkOracleExists(hre, asset, async (assetContract) => {
    const realChainlinkFeed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContract.chainlinkFeed()
    )
    const initPrice = await realChainlinkFeed.latestRoundData()
    const oracle = await overrideOracle(hre, realChainlinkFeed.address)
    await oracle.updateAnswer(initPrice.answer)
  })
}

export const setOraclePrice = async (
  hre: HardhatRuntimeEnvironment,
  asset: string,
  value: BigNumber
) => {
  await checkOracleExists(hre, asset, async (assetContract) => {
    const realChainlinkFeed = await hre.ethers.getContractAt(
      'AggregatorV3Interface',
      await assetContract.chainlinkFeed()
    )
    const oracle = await overrideOracle(hre, realChainlinkFeed.address)
    await oracle.updateAnswer(value)
  })
}
