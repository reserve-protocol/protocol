import { useEnv } from "#/utils/env"
import { BigNumber } from "ethers"
import { defaultFixtureNoBasket } from "./fixtures"
import { DeployerP1 } from "@typechain/DeployerP1"
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { CTokenWrapperMock } from "@typechain/CTokenWrapperMock"
import { CTokenFiatCollateral } from "@typechain/CTokenFiatCollateral"
import { IConfig, networkConfig } from "#/common/configuration"
import { TestIRToken } from "@typechain/TestIRToken"
import snapshotGasCost from "../utils/snapshotGasCost"
import { TestIDeployer } from "@typechain/TestIDeployer"
import { RTokenAsset } from "@typechain/RTokenAsset"
import { TestIBroker } from "@typechain/TestIBroker"
import { TestIFurnace } from "@typechain/TestIFurnace"
import { ethers, network } from "hardhat"
import { TestIStRSR } from "@typechain/TestIStRSR"
import { expect } from "chai"
import { CollateralStatus } from "../plugins/individual-collateral/pluginTestTypes"
import { advanceTime, getLatestBlockTimestamp, setNextBlockTimestamp } from "../utils/time"
import { ERC20Mock } from "@typechain/ERC20Mock"
import { CTokenMock } from "@typechain/CTokenMock"
import { CTokenWrapper } from "@typechain/CTokenWrapper"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ICToken } from "@typechain/ICToken"
import { bn, fp } from "#/common/numbers"
import { Collateral, IMPLEMENTATION, Implementation, ORACLE_ERROR, ORACLE_TIMEOUT, PRICE_TIMEOUT, REVENUE_HIDING } from "../fixtures"
import { IERC20Metadata } from "@typechain/IERC20Metadata"
import { TestIBasketHandler } from "@typechain/TestIBasketHandler"
import { TestIBackingManager } from "@typechain/TestIBackingManager"
import { IAssetRegistry } from "@typechain/IAssetRegistry"
import { TestIMain } from "@typechain/TestIMain"
import { mintCollaterals } from "../utils/tokens"
import { ComptrollerMock } from "@typechain/ComptrollerMock"
import { whileImpersonating } from "../utils/impersonation"

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe(`CTokenVault contract`, () => {
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let other: SignerWithAddress
  
    // Tokens and Assets
    let initialBal: BigNumber
    let fTokenUnwrapped: ICToken
    let fTokenWrapped: CTokenWrapper
  
    let fluxCollateralUnwrapped: Collateral
    let fluxCollateralWrapped: Collateral
  
    // Config values
    let config: IConfig
  
    // Main
    let rToken: TestIRToken
    let assetRegistry: IAssetRegistry
    let backingManager: TestIBackingManager
    let basketHandler: TestIBasketHandler
    let compoundMock: ComptrollerMock 
  
    beforeEach(async () => {
        ;[owner, addr1, addr2, other] = await ethers.getSigners()
    
        // Deploy fixture
        ;({
            assetRegistry,
            backingManager,
            basketHandler,
            config,
            rToken,
            compoundMock
        } = await loadFixture(defaultFixtureNoBasket))

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h
        const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')
        fluxCollateralUnwrapped = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
            {
                priceTimeout: PRICE_TIMEOUT,
                chainlinkFeed: networkConfig['31337'].chainlinkFeeds.DAI!,
                oracleError: ORACLE_ERROR,
                erc20: networkConfig['31337'].tokens.fDAI!,
                maxTradeVolume: config.rTokenMaxTradeVolume,
                oracleTimeout: ORACLE_TIMEOUT,
                targetName: ethers.utils.formatBytes32String('USD'),
                defaultThreshold,
                delayUntilDefault,
            },
            REVENUE_HIDING
        )
        await fluxCollateralUnwrapped.refresh()

        const CTokenWrapperFactory = await ethers.getContractFactory('CTokenWrapper')
        const erc20: IERC20Metadata = <IERC20Metadata>(
            await ethers.getContractAt('ICToken', networkConfig['31337'].tokens.fDAI!)
        )
        fTokenWrapped = await CTokenWrapperFactory.deploy(
            erc20.address,
            `${await erc20.name()} Vault`,
            `${await erc20.symbol()}-VAULT`,
            networkConfig['31337'].FLUX_FINANCE_COMPTROLLER!,
        )
        fluxCollateralWrapped = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
            {
                priceTimeout: PRICE_TIMEOUT,
                chainlinkFeed: networkConfig['31337'].chainlinkFeeds.DAI!,
                oracleError: ORACLE_ERROR,
                erc20: fTokenWrapped.address,
                maxTradeVolume: config.rTokenMaxTradeVolume,
                oracleTimeout: ORACLE_TIMEOUT,
                targetName: ethers.utils.formatBytes32String('USD'),
                defaultThreshold,
                delayUntilDefault,
            },
            REVENUE_HIDING
        )
        await fluxCollateralWrapped.refresh()

        // Advance time post warmup period
        await advanceTime(Number(config.warmupPeriod) + 1)
    
        // Mint initial balances
        const dai = await ethers.getContractAt('ERC20Mock', networkConfig['31337'].tokens.DAI!)
        fTokenUnwrapped = await ethers.getContractAt('ICToken', networkConfig['31337'].tokens.fDAI!)
        const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
        initialBal = fp('1e7') // 10x the issuance throttle amount
        await whileImpersonating(holderDAI, async (daiSigner) => {
          await dai.connect(daiSigner).transfer(addr1.address, initialBal)
        })
        await dai.connect(addr1).approve(fTokenUnwrapped.address, initialBal)
        await fTokenUnwrapped.connect(addr1).mint(initialBal)
    })

    describeGas('Gas Reporting, Flux Tokens', () => {
        let issueAmount: BigNumber
        let initialBal = fp('1e7')

        describe('Unwrapped', () => {
            let tokenBal: BigNumber

            beforeEach(async () => {
                await assetRegistry.connect(owner).register(fluxCollateralUnwrapped.address)

                const basketsNeededAmts = [fp('1.0')]
                await basketHandler.connect(owner).setPrimeBasket([fTokenUnwrapped.address], basketsNeededAmts)
                await basketHandler.connect(owner).refreshBasket()

                // Set up allowances
                await backingManager.grantRTokenAllowance(fTokenUnwrapped.address)
                
                // Charge throttle
                await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 3600)

                issueAmount = config.issuanceThrottle.amtRate

                tokenBal = await fTokenUnwrapped.balanceOf(addr1.address)
    
                // Provide approvals
                await fTokenUnwrapped.connect(addr1).approve(rToken.address, initialBal)
            })
    
            it('Transfer', async () => {
                // Transfer
                await snapshotGasCost(fTokenUnwrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10)))
    
                // Transfer again
                await snapshotGasCost(fTokenUnwrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10)))
    
                // Transfer back
                await snapshotGasCost(fTokenUnwrapped.connect(addr2).transfer(addr1.address, tokenBal.div(10)))
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
                let unwrappedBal = await fTokenUnwrapped.balanceOf(addr1.address)
                await fTokenUnwrapped.connect(addr1).approve(fTokenWrapped.address, unwrappedBal)
                await fTokenWrapped.connect(addr1).deposit(unwrappedBal, addr1.address)
                await assetRegistry.connect(owner).register(fluxCollateralWrapped.address)

                const basketsNeededAmts = [fp('1.0')]
                await basketHandler.connect(owner).setPrimeBasket([fTokenWrapped.address], basketsNeededAmts)
                await basketHandler.connect(owner).refreshBasket()

                // Set up allowances
                await backingManager.grantRTokenAllowance(fTokenWrapped.address)
                
                // Charge throttle
                await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 3600)

                issueAmount = config.issuanceThrottle.amtRate
    
                tokenBal = await fTokenWrapped.balanceOf(addr1.address)

                // Provide approvals
                await fTokenWrapped.connect(addr1).approve(rToken.address, initialBal)
            })
    
            it('Transfer', async () => {
                
                // Transfer
                await snapshotGasCost(fTokenWrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10)))
    
                // Transfer again
                await snapshotGasCost(fTokenWrapped.connect(addr1).transfer(addr2.address, tokenBal.div(10)))
    
                // Transfer back
                await snapshotGasCost(fTokenWrapped.connect(addr2).transfer(addr1.address, tokenBal.div(10)))
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