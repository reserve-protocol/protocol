import { setCode } from '@nomicfoundation/hardhat-network-helpers'
import { EACAggregatorProxyMock } from '@typechain/EACAggregatorProxyMock'
import { BigNumber } from 'ethers'
import { ethers, network } from 'hardhat'
import { expect } from 'chai'
import { fp, bn, divCeil } from '../../common/numbers'
import { MAX_UINT192 } from '../../common/constants'
import { getLatestBlockTimestamp } from './time'
import { whileImpersonating } from './impersonation'

const toleranceDivisor = bn('1e15') // 1 part in 1000 trillions

export const expectExactPrice = async (assetAddr: string, price: [BigNumber, BigNumber]) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  expect(lowPrice).to.equal(price[0])
  expect(highPrice).to.equal(price[1])
}

// Expects a price around `avgPrice` assuming a consistent percentage oracle error
// If near is truthy, allows a small error of 1 part in 1000 trillions
export const expectPrice = async (
  assetAddr: string,
  avgPrice: BigNumber,
  oracleError: BigNumber,
  near: boolean,
  overrideToleranceDiv?: BigNumber
) => {
  let lowPrice, highPrice
  try {
    const bh = await ethers.getContractAt('IBasketHandler', assetAddr)
    ;[lowPrice, highPrice] = await bh.price(false) // without issuance premium
  } catch {
    const asset = await ethers.getContractAt('Asset', assetAddr)
    ;[lowPrice, highPrice] = await asset.price()
  }
  const delta = avgPrice.mul(oracleError).div(fp('1'))
  const expectedLow = avgPrice.sub(delta)
  const expectedHigh = avgPrice.add(delta)

  if (near) {
    const tolerance = avgPrice.div(overrideToleranceDiv ?? toleranceDivisor)
    expect(lowPrice).to.be.closeTo(expectedLow, tolerance)
    expect(highPrice).to.be.closeTo(expectedHigh, tolerance)
  } else {
    expect(lowPrice).to.equal(expectedLow)
    expect(highPrice).to.equal(expectedHigh)
  }
}

// Expects a price around `avgPrice` assuming a consistent percentage oracle error
// If the RToken is fully collateralized, there's no need to provide maxTradeSlippage/dustLoss
// If maxTradeSlippage is truthy, applies a % reduction to the expected lower price
// If dustLoss is additionally truthy, applies a nominal reduction to the expected lower price
export const expectRTokenPrice = async (
  assetAddr: string,
  avgPrice: BigNumber,
  oracleError: BigNumber,
  maxTradeSlippage?: BigNumber,
  dustLoss?: BigNumber
) => {
  const rTokenAsset = await ethers.getContractAt('RTokenAsset', assetAddr)
  const delta = avgPrice.mul(oracleError).div(fp('1'))

  // Apply two sets of oracleError discounts to account for the opposite basket price estimate
  // being used to calculate range.bottom
  let expectedLow = avgPrice.sub(delta)
  expectedLow = expectedLow.sub(expectedLow.mul(oracleError).div(fp('1')))
  expectedLow = expectedLow.sub(expectedLow.mul(oracleError).div(fp('1')))

  // Apply four sets of oracleError discounts: 2 on the sell side and 2 on the by side
  // The reason this is four instead of two is that range.top has contributions from
  // deficit as well as surplus, whereas range.bottom only has contributions from surpluses
  // (because balances are evaluated relative to wholeBasketsHeld)
  let expectedHigh = avgPrice.add(delta)
  expectedHigh = expectedHigh.add(expectedHigh.mul(oracleError).div(fp('1')))
  expectedHigh = expectedHigh.add(expectedHigh.mul(oracleError).div(fp('1')))
  if (avgPrice.sub(delta).gt(0)) {
    expectedHigh = expectedHigh.mul(avgPrice).div(avgPrice.sub(delta)).add(1)
    expectedHigh = expectedHigh.mul(avgPrice).div(avgPrice.sub(delta)).add(1)
  }

  if (maxTradeSlippage) {
    // There can be any amount of shortfall, from zero to all the capital held by BackingManager
    // Here we assume it is ALL shortfall, since it's hard to know at any given time the portion
    const shortfallSlippage = divCeil(expectedHigh.mul(maxTradeSlippage), fp('1'))
    expectedLow = expectedLow.sub(shortfallSlippage)

    if (dustLoss) {
      const rToken = await ethers.getContractAt('IRToken', await rTokenAsset.erc20())
      const supply = await rToken.totalSupply()
      const dustLostFraction = supply.gt(0) ? dustLoss.mul(fp('1')).div(supply) : dustLoss
      expectedLow = expectedLow.sub(dustLostFraction)
    }
  }

  const [lowPrice, highPrice] = await rTokenAsset.price()
  expect(lowPrice).to.be.gte(expectedLow)
  expect(lowPrice).to.be.lte(avgPrice)
  expect(highPrice).to.be.lte(expectedHigh)
  expect(highPrice).to.be.gte(avgPrice)
}

export const expectDecayedPrice = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  expect(lowPrice).to.be.gt(0)
  expect(lowPrice).to.be.lt(await asset.savedLowPrice())
  expect(highPrice).to.be.gt(await asset.savedHighPrice())
  expect(highPrice).to.be.lt(MAX_UINT192)
}

// Expects an unpriced asset with low = 0 and high = FIX_MAX
export const expectUnpriced = async (assetAddr: string) => {
  let lowPrice, highPrice
  try {
    const asset = await ethers.getContractAt('Asset', assetAddr)
    ;[lowPrice, highPrice] = await asset.price()
  } catch (e) {
    const bh = await ethers.getContractAt('IBasketHandler', assetAddr)
    ;[lowPrice, highPrice] = await bh.price(false) // without issuance premium
  }
  expect(lowPrice).to.equal(0)
  expect(highPrice).to.equal(MAX_UINT192)
}

// Use to set reference unit chainlink oracle for an asset, by address
export const setOraclePrice = async (assetAddr: string, price: BigNumber) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.updateAnswer(price)
}

// Use to invalidate a Chainlink oracle for an asset using latest timestamp
export const setInvalidOracleTimestamp = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.setInvalidTimestamp()
}

// Use to invalidate a Chainlink oracle for an asset using the last answered round
export const setInvalidOracleAnsweredRound = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.setInvalidAnsweredRound()
}

// === Pushing oracles (real or mock) forward ===

export const overrideOracle = async (oracleAddress: string): Promise<EACAggregatorProxyMock> => {
  const oracle = await ethers.getContractAt(
    'contracts/plugins/mocks/EACAggregatorProxyMock.sol:EACAggregatorProxy',
    oracleAddress
  )
  const aggregator = await oracle.aggregator()
  const accessController = await oracle.accessController()
  let initPrice
  try {
    initPrice = await oracle.latestAnswer()
  } catch {
    initPrice = (await oracle.latestRoundData()).answer
  }
  const mockOracleFactory = await ethers.getContractFactory('EACAggregatorProxyMock')
  const mockOracle = await mockOracleFactory.deploy(aggregator, accessController, initPrice)
  const bytecode = await network.provider.send('eth_getCode', [mockOracle.address])
  await setCode(oracleAddress, bytecode)
  return ethers.getContractAt('EACAggregatorProxyMock', oracleAddress)
}

export const pushOracleForward = async (chainlinkAddr: string) => {
  const chainlinkFeed = await ethers.getContractAt('MockV3Aggregator', await chainlinkAddr)
  let initPrice
  // awkward workaround for sfrxETH oracle
  try {
    initPrice = await chainlinkFeed.latestAnswer()
  } catch {
    initPrice = (await chainlinkFeed.latestRoundData()).answer
  }
  try {
    // Try to update as if it's a mock already
    await chainlinkFeed.updateAnswer(initPrice)
  } catch {
    // Not a mock; need to override the oracle first
    const oracle = await overrideOracle(chainlinkFeed.address)
    await oracle.updateAnswer(initPrice)
  }
}

export const pushFraxOracleForward = async (chainlinkAddr: string) => {
  const chainlinkFeed = await ethers.getContractAt('FraxAggregatorV3Interface', chainlinkAddr)
  const initPrice = (await chainlinkFeed.latestRoundData()).answer
  await whileImpersonating(await chainlinkFeed.priceSource(), async (owner) => {
    await chainlinkFeed
      .connect(owner)
      .addRoundData(false, initPrice, initPrice, (await getLatestBlockTimestamp()) + 1)
  })
}
