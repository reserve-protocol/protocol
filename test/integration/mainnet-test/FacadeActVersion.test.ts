import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { evmRevert, evmSnapshot } from '../utils'
import { bn } from '../../../common/numbers'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import forkBlockNumber from '../fork-block-numbers'
import { FacadeAct, RevenueTraderP1 } from '../../../typechain'
import { useEnv } from '#/utils/env'
import { getLatestBlockNumber, getLatestBlockTimestamp } from '#/utils/time'

const describeFork = useEnv('FORK') ? describe : describe.skip

const REVENUE_TRADER_ADDR = '0xE04C26F68E0657d402FA95377aa7a2838D6cBA6f' // V2
const FACADE_ACT_ADDR = '0xeaCaF85eA2df99e56053FD0250330C148D582547' // V3
const SELL_TOKEN_ADDR = '0x60C384e226b120d93f3e0F4C502957b2B9C32B15' // aUSDC

describeFork(
  `FacadeAct - Settle Auctions - Mainnet Check - Mainnet Forking P${IMPLEMENTATION}`,
  function () {
    let facadeAct: FacadeAct
    let newFacadeAct: FacadeAct
    let revenueTrader: RevenueTraderP1
    let chainId: number

    let snap: string

    // Setup test environment
    const setup = async (blockNumber: number) => {
      // Use Mainnet fork
      await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [
          {
            forking: {
              jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
              blockNumber: blockNumber,
            },
          },
        ],
      })
    }

    describe('FacadeAct', () => {
      before(async () => {
        await setup(forkBlockNumber['mainnet-2.0'])

        chainId = await getChainId(hre)
        if (!networkConfig[chainId]) {
          throw new Error(`Missing network configuration for ${hre.network.name}`)
        }

        snap = await evmSnapshot()
      })

      beforeEach(async () => {
        await evmRevert(snap)
        snap = await evmSnapshot()

        // Get contracts
        facadeAct = <FacadeAct>await ethers.getContractAt('FacadeAct', FACADE_ACT_ADDR)
        revenueTrader = <RevenueTraderP1>(
          await ethers.getContractAt('RevenueTraderP1', REVENUE_TRADER_ADDR)
        )
      })

      after(async () => {
        await evmRevert(snap)
      })

      it('Should settle trade successfully', async () => {
        expect(await revenueTrader.tradesOpen()).to.equal(1)
        await expect(revenueTrader.settleTrade(SELL_TOKEN_ADDR)).to.not.be.reverted
        expect(await revenueTrader.tradesOpen()).to.equal(0)
      })

      it('Should fail with deployed FacadeAct', async () => {
        expect(await revenueTrader.tradesOpen()).to.equal(1)
        await expect(
          facadeAct.runRevenueAuctions(revenueTrader.address, [SELL_TOKEN_ADDR], [], [1])
        ).to.be.reverted
        expect(await revenueTrader.tradesOpen()).to.equal(1)
      })

      it('Should work with fixed FacadeAct', async () => {
        expect(await revenueTrader.tradesOpen()).to.equal(1)

        const FacadeActFactory = await ethers.getContractFactory('FacadeAct')
        newFacadeAct = await FacadeActFactory.deploy()

        await newFacadeAct.runRevenueAuctions(revenueTrader.address, [SELL_TOKEN_ADDR], [], [1])

        expect(await revenueTrader.tradesOpen()).to.equal(0)
      })

      it('Fixed FacadeAct should return right revenueOverview', async () => {
        console.log('Block number ', await getLatestBlockNumber(hre))
        console.log('Timestamp ', await getLatestBlockTimestamp(hre))
        const FacadeActFactory = await ethers.getContractFactory('FacadeAct')
        newFacadeAct = await FacadeActFactory.deploy()

        const expectedSurpluses = [
          bn('13498155707558299290000'),
          bn('9076'),
          bn('0'),
          bn('9791033088306000000'),
          bn('0'),
          bn('3899620000'),
          bn('0'),
          bn('30109289810000'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('6413550000'),
        ]
        const expectedBmRewards = [
          bn('0'),
          bn('0'),
          bn('0'),
          bn('9999'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
          bn('0'),
        ]
        const [, , surpluses, , bmRewards, revTraderRewards] =
          await newFacadeAct.callStatic.revenueOverview(revenueTrader.address)

        for (let i = 0; i < surpluses.length; i++) {
          if (expectedSurpluses[i].gt(0)) expect(surpluses[i]).gte(expectedSurpluses[i])
          if (expectedBmRewards[i].gt(0)) expect(bmRewards[i]).gte(expectedBmRewards[i])
          expect(revTraderRewards[i]).to.equal(0)
        }
      })

      it('Fixed FacadeAct should run revenue auctions', async () => {
        const FacadeActFactory = await ethers.getContractFactory('FacadeAct')
        newFacadeAct = await FacadeActFactory.deploy()

        expect(await revenueTrader.tradesOpen()).to.equal(1)
        const main = await ethers.getContractAt('IMain', await revenueTrader.main())
        await expect(
          newFacadeAct.runRevenueAuctions(revenueTrader.address, [], [await main.rToken()], [0])
        ).to.emit(revenueTrader, 'TradeStarted')

        expect(await revenueTrader.tradesOpen()).to.equal(2)
      })
    })
  }
)
