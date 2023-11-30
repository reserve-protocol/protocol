import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { Collateral, IMPLEMENTATION } from '../fixtures'
import { defaultFixtureNoBasket } from './fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, networkConfig } from '../../common/configuration'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import forkBlockNumber from './fork-block-numbers'
import {
  ATokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeTest,
  FacadeInvariantMonitor,
  FiatCollateral,
  IAToken,
  IERC20,
  StaticATokenLM,
  TestIBasketHandler,
  TestIMain,
  TestIRToken,
  CTokenWrapper,
} from '../../typechain'
import { useEnv } from '#/utils/env'

enum CollPluginType {
  AAVE_V2,
  COMPOUND_V2,
}

// Relevant addresses (Mainnet)
// DAI, cDAI, and aDAI Holders
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderCDAI = '0x01d127D90513CCB6071F83eFE15611C4d9890668'
const holderADAI = '0x07edE94cF6316F4809f2B725f5d79AD303fB4Dc8'

let owner: SignerWithAddress

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(
  `FacadeInvariantMonitor - Integration - Mainnet Forking P${IMPLEMENTATION}`,
  function () {
    let addr1: SignerWithAddress

    // Assets
    let collateral: Collateral[]

    // Tokens and Assets
    let dai: ERC20Mock
    let aDai: IAToken
    let stataDai: StaticATokenLM

    let cDai: CTokenMock
    let cDaiVault: CTokenWrapper

    let daiCollateral: FiatCollateral

    let aDaiCollateral: ATokenFiatCollateral

    // Contracts to retrieve after deploy
    let rToken: TestIRToken
    let main: TestIMain
    let facadeTest: FacadeTest
    let facadeInvariantMonitor: FacadeInvariantMonitor
    let basketHandler: TestIBasketHandler
    let config: IConfig

    let initialBal: BigNumber
    let basket: Collateral[]
    let erc20s: IERC20[]

    let chainId: number

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

    describe('FacadeInvariantMonitor', () => {
      before(async () => {
        await setup(forkBlockNumber['facade-invariant-monitor'])

        chainId = await getChainId(hre)
        if (!networkConfig[chainId]) {
          throw new Error(`Missing network configuration for ${hre.network.name}`)
        }
      })

      beforeEach(async () => {
        ;[owner, addr1] = await ethers.getSigners()
        ;({
          erc20s,
          collateral,
          basket,
          main,
          basketHandler,
          rToken,
          facadeTest,
          facadeInvariantMonitor,
          config,
        } = await loadFixture(defaultFixtureNoBasket))

        // Get tokens
        dai = <ERC20Mock>erc20s[0] // DAI
        cDaiVault = <CTokenWrapper>erc20s[6] // cDAI
        cDai = <CTokenMock>await ethers.getContractAt('CTokenMock', await cDaiVault.underlying()) // cDAI
        stataDai = <StaticATokenLM>erc20s[10] // static aDAI

        // Get plain aTokens
        aDai = <IAToken>(
          await ethers.getContractAt(
            '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
            networkConfig[chainId].tokens.aDAI || ''
          )
        )

        // Get collaterals
        daiCollateral = <FiatCollateral>collateral[0] // DAI
        aDaiCollateral = <ATokenFiatCollateral>collateral[10] // aDAI

        // Get assets and tokens for default basket
        daiCollateral = <FiatCollateral>basket[0]
        aDaiCollateral = <ATokenFiatCollateral>basket[1]

        dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await daiCollateral.erc20())
        stataDai = <StaticATokenLM>(
          await ethers.getContractAt('StaticATokenLM', await aDaiCollateral.erc20())
        )

        // Get plain aToken
        aDai = <IAToken>(
          await ethers.getContractAt(
            '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
            networkConfig[chainId].tokens.aDAI || ''
          )
        )

        // Setup balances for addr1 - Transfer from Mainnet holders DAI, cDAI and aDAI (for default basket)
        // DAI
        initialBal = bn('20000e18')
        await whileImpersonating(holderDAI, async (daiSigner) => {
          await dai.connect(daiSigner).transfer(addr1.address, initialBal)
        })
        // aDAI
        await whileImpersonating(holderADAI, async (adaiSigner) => {
          // Wrap ADAI into static ADAI
          await aDai.connect(adaiSigner).transfer(addr1.address, initialBal)
          await aDai.connect(addr1).approve(stataDai.address, initialBal)
          await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, false)
        })
        // cDAI
        await whileImpersonating(holderCDAI, async (cdaiSigner) => {
          await cDai
            .connect(cdaiSigner)
            .transfer(addr1.address, toBNDecimals(initialBal, 8).mul(100))
          await cDai.connect(addr1).approve(cDaiVault.address, toBNDecimals(initialBal, 8).mul(100))
          await cDaiVault
            .connect(addr1)
            .deposit(toBNDecimals(initialBal, 8).mul(100), addr1.address)
        })
      })

      context('Reedemable Tokens - AaveV2, CompoundV2', () => {
        beforeEach(async () => {
          // Setup basket
          await basketHandler
            .connect(owner)
            .setPrimeBasket(
              [dai.address, stataDai.address, cDaiVault.address],
              [fp('0.25'), fp('0.25'), fp('0.5')]
            )
          await basketHandler.connect(owner).refreshBasket()
          await advanceTime(Number(config.warmupPeriod) + 1)
        })

        it('Should return backing redeemable correctly', async function () {
          const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
          const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

          // Provide approvals
          await dai.connect(addr1).approve(rToken.address, issueAmount)
          await stataDai.connect(addr1).approve(rToken.address, issueAmount)
          await cDaiVault
            .connect(addr1)
            .approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

          // Check rToken balance
          expect(await rToken.balanceOf(addr1.address)).to.equal(0)
          expect(await rToken.balanceOf(main.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(0)

          // Issue rTokens
          await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

          // Check RTokens issued to user
          expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
          expect(await rToken.balanceOf(main.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check asset value
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
            issueAmount,
            fp('150')
          ) // approx 10K in value

          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.AAVE_V2,
              stataDai.address
            )
          ).to.equal(fp('1'))

          expect(
            await facadeInvariantMonitor.backingReedemable(
              rToken.address,
              CollPluginType.COMPOUND_V2,
              cDaiVault.address
            )
          ).to.equal(fp('1'))
        })
      })
    })
  }
)
