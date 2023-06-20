import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { evmRevert, evmSnapshot } from '../utils'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import forkBlockNumber from '../fork-block-numbers'
import { FacadeAct, RevenueTraderP1 } from '../../../typechain'
import { useEnv } from '#/utils/env'

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
    })
  }
)
