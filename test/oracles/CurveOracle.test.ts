import hre, { ethers } from 'hardhat'

import { useEnv } from '#/utils/env'
import { resetFork } from '#/utils/chain'
import { CurveOracle } from '@typechain/index'

enum OracleType {
  STORED,
  RTOKEN,
  CHAINLINK,
}

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('Curve Oracle', () => {
  describe('USD3/sDAI - Mainnet', () => {
    let curveOracle: CurveOracle

    beforeEach(async () => {
      // Mainnet Fork only
      await resetFork(hre, 21093000)

      const CurveOracleFactory = await ethers.getContractFactory('CurveOracle')
      curveOracle = await CurveOracleFactory.deploy(
        '0x0e84996ac18fcf6fe18c372520798ce0cdf892d4',
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          timeout: 0,
        },
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          timeout: 0,
        }
      )
    })

    it('log', async () => {
      console.log(await curveOracle.getPrice())
      // 1.0161845170 - manual calc etherscan
      // 1.0134000000 - curve ui
      // 1.0323744085 - the output wtf
    })
  })

  describe('dgnETH/ETH+ - Mainnet', () => {
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
          timeout: 0,
        },
        {
          oracleType: OracleType.STORED,
          rateProvider: ethers.constants.AddressZero,
          timeout: 0,
        }
      )
    })

    it('log', async () => {
      console.log(await curveOracle.getPrice())
      // 1.0034 - manual calc
      // 1.0033 - curve ui
      // 1.0036 - the output
    })
  })
})
