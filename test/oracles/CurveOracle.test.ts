import hre, { ethers } from 'hardhat'

import { useEnv } from '#/utils/env'
import { resetFork } from '#/utils/chain'
import { CurveOracle } from '@typechain/index'
import { BigNumber } from 'ethers'
import { expect } from 'chai'

enum OracleType {
  STORED,
  STATIC,
  RTOKEN,
  CHAINLINK,
}

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('Rate Oracles', () => {
  describe('USD3/sDAI - Curve LP - Mainnet', () => {
    let curveOracle: CurveOracle

    beforeEach(async () => {
      // Mainnet Fork only
      await resetFork(hre, 21093000)

      const CurveOracleFactory = await ethers.getContractFactory('CurveOracle')
      curveOracle = await CurveOracleFactory.deploy(
        '0x0e84996ac18fcf6fe18c372520798ce0cdf892d4',
        {
          oracleType: OracleType.STATIC,
          rateProvider: ethers.constants.AddressZero,
          staticValue: BigNumber.from(10).pow(18),
          timeout: 0,
        },
        {
          oracleType: OracleType.CHAINLINK,
          rateProvider: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9', // DAI/USD Chainlink
          staticValue: 0,
          timeout: 3600,
        }
      )
    })

    it('log', async () => {
      const price = await curveOracle.getPrice()
      console.log(price)
      expect(price).to.be.eq(BigNumber.from(1012370583548288620n))
    })
  })

  describe('dgnETH/ETH+ - Yearn Vault - Mainnet', () => {
    let curveOracle: CurveOracle

    beforeEach(async () => {
      // Mainnet Fork only
      await resetFork(hre, 21093000)

      const CurveOracleFactory = await ethers.getContractFactory('YearnCurveOracle')
      curveOracle = await CurveOracleFactory.deploy(
        '0x961Ad224fedDFa468c81acB3A9Cc2cC4731809f4',
        '0x5ba541585d6297b756f08b7c61a7e37752123b4f',
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          staticValue: 0,
          timeout: 0,
        },
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          staticValue: 0,
          timeout: 0,
        }
      )
    })

    it('log', async () => {
      const price = await curveOracle.getPrice()
      console.log(price)
      expect(price).to.be.eq(BigNumber.from(1014465272399087787n))
    })
  })

  describe('dgnETH/ETH+ - Curve LP - Mainnet', () => {
    let curveOracle: CurveOracle

    beforeEach(async () => {
      // Mainnet Fork only
      await resetFork(hre, 21093000)

      const CurveOracleFactory = await ethers.getContractFactory('CurveOracle')
      curveOracle = await CurveOracleFactory.deploy(
        '0x5ba541585d6297b756f08b7c61a7e37752123b4f',
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          staticValue: 0,
          timeout: 0,
        },
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          staticValue: 0,
          timeout: 0,
        }
      )
    })

    it('log', async () => {
      const price = await curveOracle.getPrice()
      console.log(price)
      expect(price).to.be.eq(BigNumber.from(1003642593037842342n))
    })
  })
})
