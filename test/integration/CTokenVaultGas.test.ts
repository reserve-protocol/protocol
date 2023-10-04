import { useEnv } from '#/utils/env'
import { BigNumber } from 'ethers'
import { defaultFixtureNoBasket } from './fixtures'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { CTokenFiatCollateral } from '@typechain/CTokenFiatCollateral'
import { IConfig, networkConfig } from '#/common/configuration'
import { TestIRToken } from '@typechain/TestIRToken'
import snapshotGasCost from '../utils/snapshotGasCost'
import { ethers } from 'hardhat'
import { advanceTime, getLatestBlockTimestamp, setNextBlockTimestamp } from '../utils/time'
import { CTokenWrapper } from '@typechain/CTokenWrapper'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ICToken } from '@typechain/ICToken'
import { bn, fp } from '#/common/numbers'
import {
  Collateral,
  IMPLEMENTATION,
  Implementation,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../fixtures'
import { IERC20Metadata } from '@typechain/IERC20Metadata'
import { TestIBasketHandler } from '@typechain/TestIBasketHandler'
import { TestIBackingManager } from '@typechain/TestIBackingManager'
import { IAssetRegistry } from '@typechain/IAssetRegistry'
import { whileImpersonating } from '../utils/impersonation'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe(`CTokenVault contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens and Assets
  let initialBal: BigNumber
  let cTokenUnwrapped: ICToken
  let cTokenWrapped: CTokenWrapper

  let cTokenCollateralUnwrapped: Collateral
  let cTokenCollateralWrapped: Collateral

  // Config values
  let config: IConfig

  // Main
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({ assetRegistry, backingManager, basketHandler, config, rToken } = await loadFixture(
      defaultFixtureNoBasket
    ))

    const defaultThreshold = fp('0.01') // 1%
    const delayUntilDefault = bn('86400') // 24h
    const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')
    cTokenCollateralUnwrapped = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig['31337'].chainlinkFeeds.DAI!,
        oracleError: ORACLE_ERROR,
        erc20: networkConfig['31337'].tokens.cDAI!,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      REVENUE_HIDING
    )
    await cTokenCollateralUnwrapped.refresh()

    const CTokenWrapperFactory = await ethers.getContractFactory('CTokenWrapper')
    const erc20: IERC20Metadata = <IERC20Metadata>(
      await ethers.getContractAt('ICToken', networkConfig['31337'].tokens.cDAI!)
    )
    cTokenWrapped = await CTokenWrapperFactory.deploy(
      erc20.address,
      `${await erc20.name()} Vault`,
      `${await erc20.symbol()}-VAULT`,
      networkConfig['31337'].COMPTROLLER!
    )
    cTokenCollateralWrapped = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig['31337'].chainlinkFeeds.DAI!,
        oracleError: ORACLE_ERROR,
        erc20: cTokenWrapped.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      REVENUE_HIDING
    )
    await cTokenCollateralWrapped.refresh()

    // Advance time post warmup period
    await advanceTime(Number(config.warmupPeriod) + 1)

    // Mint initial balances
    const dai = await ethers.getContractAt('ERC20Mock', networkConfig['31337'].tokens.DAI!)
    cTokenUnwrapped = await ethers.getContractAt('ICToken', networkConfig['31337'].tokens.cDAI!)
    const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
    initialBal = fp('1e7') // 10x the issuance throttle amount
    await whileImpersonating(holderDAI, async (daiSigner) => {
      await dai.connect(daiSigner).transfer(addr1.address, initialBal)
    })
    await dai.connect(addr1).approve(cTokenUnwrapped.address, initialBal)
    await cTokenUnwrapped.connect(addr1).mint(initialBal)
  })

  describeGas('Gas Reporting, cTokens', () => {
    const initialBal = fp('1e7')

    describe('Unwrapped', () => {
      let tokenBal: BigNumber

      beforeEach(async () => {
        await assetRegistry.connect(owner).register(cTokenCollateralUnwrapped.address)

        const basketsNeededAmts = [fp('1.0')]
        await basketHandler
          .connect(owner)
          .setPrimeBasket([cTokenUnwrapped.address], basketsNeededAmts)
        await basketHandler.connect(owner).refreshBasket()

        // Set up allowances
        await backingManager.grantRTokenAllowance(cTokenUnwrapped.address)

        // Charge throttle
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 3600)

        tokenBal = await cTokenUnwrapped.balanceOf(addr1.address)

        // Provide approvals
        await cTokenUnwrapped.connect(addr1).approve(rToken.address, initialBal)
      })

      it('Transfer', async () => {
        // Transfer
        await snapshotGasCost(
          cTokenUnwrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10))
        )

        // Transfer again
        await snapshotGasCost(
          cTokenUnwrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10))
        )

        // Transfer back
        await snapshotGasCost(
          cTokenUnwrapped.connect(addr2).transfer(addr1.address, tokenBal.div(10))
        )
      })

      it('Issue RToken', async () => {
        // Issue rTokens twice within block
        await snapshotGasCost(rToken.connect(addr1).issue(tokenBal.div(10)))
        await snapshotGasCost(rToken.connect(addr1).issue(tokenBal.div(10)))
      })

      it('Redeem RToken', async () => {
        await rToken.connect(addr1).issue(tokenBal.div(10))
        await snapshotGasCost(rToken.connect(addr1).redeem(tokenBal.div(10)))
      })
    })

    describe('Wrapped', () => {
      let tokenBal: BigNumber

      beforeEach(async () => {
        const unwrappedBal = await cTokenUnwrapped.balanceOf(addr1.address)
        await cTokenUnwrapped.connect(addr1).approve(cTokenWrapped.address, unwrappedBal)
        await cTokenWrapped.connect(addr1).deposit(unwrappedBal, addr1.address)
        await assetRegistry.connect(owner).register(cTokenCollateralWrapped.address)

        const basketsNeededAmts = [fp('1.0')]
        await basketHandler
          .connect(owner)
          .setPrimeBasket([cTokenWrapped.address], basketsNeededAmts)
        await basketHandler.connect(owner).refreshBasket()

        // Set up allowances
        await backingManager.grantRTokenAllowance(cTokenWrapped.address)

        // Charge throttle
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 3600)

        tokenBal = await cTokenWrapped.balanceOf(addr1.address)

        // Provide approvals
        await cTokenWrapped.connect(addr1).approve(rToken.address, initialBal)
      })

      it('Transfer', async () => {
        // Transfer
        await snapshotGasCost(
          cTokenWrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10))
        )

        // Transfer again
        await snapshotGasCost(
          cTokenWrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10))
        )

        // Transfer back
        await snapshotGasCost(
          cTokenWrapped.connect(addr2).transfer(addr1.address, tokenBal.div(10))
        )
      })

      it('Issue RToken', async () => {
        // Issue rTokens twice within block
        await snapshotGasCost(rToken.connect(addr1).issue(tokenBal.div(10)))
        await snapshotGasCost(rToken.connect(addr1).issue(tokenBal.div(10)))
      })

      it('Redeem RToken', async () => {
        await rToken.connect(addr1).issue(tokenBal.div(10))
        await snapshotGasCost(rToken.connect(addr1).redeem(tokenBal.div(10)))
      })
    })
  })
})
