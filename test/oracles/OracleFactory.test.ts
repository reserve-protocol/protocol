import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { bn } from '#/common/numbers'
import { useEnv } from '#/utils/env'
import { resetFork } from '#/utils/chain'
import { advanceTime } from '#/utils/time'
import { getChainId } from '#/common/blockchain-utils'
import { getRTokenAddr } from '../../tasks/deployment/create-oracle-factory'
import { ExchangeRateOracle, ReferenceRateOracle } from '../../typechain-types'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('OracleFactory', () => {
  let exchangeRateOracle: ExchangeRateOracle
  let referenceRateOracle: ReferenceRateOracle

  beforeEach(async () => {
    // Mainnet Fork only
    await resetFork(hre, 23485273)

    const OracleFactory = await ethers.getContractFactory('OracleFactory')
    const oracleFactory = await OracleFactory.deploy()

    const chainId = await getChainId(hre)
    const rTokenAddr = getRTokenAddr(chainId)

    await oracleFactory.deployOracle(rTokenAddr)
    const oracles = await oracleFactory.oracleRegistry(rTokenAddr)

    exchangeRateOracle = await ethers.getContractAt(
      'ExchangeRateOracle',
      oracles.exchangeRateOracle
    )

    referenceRateOracle = await ethers.getContractAt(
      'ReferenceRateOracle',
      oracles.referenceRateOracle
    )
  })

  describe('ExchangeRateOracle - ETH+ - Mainnet', () => {
    it('should return exchange rate', async () => {
      const { answer } = await exchangeRateOracle.latestRoundData()
      expect(answer).to.be.eq(bn('1055859932301199515'))
    })

    it('should continue to return exchange rate even after oracles expired', async () => {
      await advanceTime(hre, 604800)
      const { answer } = await exchangeRateOracle.latestRoundData()
      expect(answer).to.be.eq(bn('1055859932301199515'))
    })
  })

  describe('ReferenceRateOracle - ETH+ - Mainnet', () => {
    it('should return reference rate', async () => {
      const { answer } = await referenceRateOracle.latestRoundData()
      expect(answer).to.be.eq(bn('4561790902935136141190'))
    })

    it('should revert after oracles expired', async () => {
      await advanceTime(hre, 604800)
      await expect(referenceRateOracle.latestRoundData()).to.be.revertedWith('invalid price')
    })
  })
})
