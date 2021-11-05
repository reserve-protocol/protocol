import { expect } from 'chai'
import { ethers } from 'hardhat'
import hre from 'hardhat'
import { getSimpleTokenPrice } from '../utils/coingecko'
import { BN_SCALE_FACTOR } from '../../common/constants'
import { BigNumber, ContractFactory } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { OracleCallerMockP0 } from '../../typechain/OracleCallerMockP0'

interface IOracleInfo {
  compound: string
  aave: string
}

// Token addresses (Mainnet)
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

// AAVE and Compound contracts (Mainnet)
const AAVE_LENDING_POOL = '0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9'
const COMPTROLLER = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b'

const PRICE_THRESHOLD: number = 0.1 // 10%

describe.skip('Oracle Library (Mainnet Forking)', () => {
  let owner: SignerWithAddress
  let oracleInfo: IOracleInfo

  // Oracle Caller contract
  let OracleCallerFactory: ContractFactory
  let oracleCaller: OracleCallerMockP0

  let cgeckoSimpleTokenPrice: number

  before(async () => {
    ;[owner] = await ethers.getSigners()

    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ALCHEMY_MAINNET_RPC_URL,
            blockNumber: 13557259,
          },
        },
      ],
    })

    // Deploy Oracle Caller
    oracleInfo = {
      compound: COMPTROLLER,
      aave: AAVE_LENDING_POOL,
    }
    OracleCallerFactory = await ethers.getContractFactory('OracleCallerMockP0')
    oracleCaller = <OracleCallerMockP0>await OracleCallerFactory.deploy(oracleInfo)
  })

  describe('Aave - Get Prices', () => {
    it(`Should return price for USDC`, async function () {
      const price: BigNumber = await oracleCaller.consultAaveOracle(USDC)

      // Get price of token in USD (from Coingecko)
      cgeckoSimpleTokenPrice = await getSimpleTokenPrice(USDC, 'usd')

      expect(price.div(BN_SCALE_FACTOR).toNumber()).to.be.within(
        cgeckoSimpleTokenPrice - cgeckoSimpleTokenPrice * PRICE_THRESHOLD,
        cgeckoSimpleTokenPrice + cgeckoSimpleTokenPrice * PRICE_THRESHOLD
      )
    })

    it('Should return price for WETH', async function () {
      let price: BigNumber = await oracleCaller.consultAaveOracle(WETH)

      // Get price of USDC in USD (from Coingecko)
      cgeckoSimpleTokenPrice = await getSimpleTokenPrice(WETH, 'usd')

      expect(price.div(BN_SCALE_FACTOR).toNumber()).to.be.within(
        cgeckoSimpleTokenPrice - cgeckoSimpleTokenPrice * PRICE_THRESHOLD,
        cgeckoSimpleTokenPrice + cgeckoSimpleTokenPrice * PRICE_THRESHOLD
      )
    })
  })

  describe('Compound - Get Prices', () => {
    it('Should return price for USDC', async function () {
      let price: BigNumber = await oracleCaller.consultCompoundOracle(USDC)

      // Get price of USDC in USD (from Coingecko)
      cgeckoSimpleTokenPrice = await getSimpleTokenPrice(USDC, 'usd')

      expect(price.div(BN_SCALE_FACTOR).toNumber()).to.be.within(
        cgeckoSimpleTokenPrice - cgeckoSimpleTokenPrice * PRICE_THRESHOLD,
        cgeckoSimpleTokenPrice + cgeckoSimpleTokenPrice * PRICE_THRESHOLD
      )
    })
  })
})
