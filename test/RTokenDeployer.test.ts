import { ethers } from "hardhat"
import { expect } from "chai"
import { expectInReceipt } from "../common/events"
import { ZERO_ADDRESS } from "../common/constants"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { RTokenMock } from "../typechain/RTokenMock.d"
import { InsurancePoolMock } from "../typechain/InsurancePoolMock.d"
import { RTokenDeployer } from "../typechain/RTokenDeployer.d"
import { IBasketToken, IRSRConfig, IRTokenParams } from "../common/configuration"
import { ReserveRightsTokenMock } from "../typechain/ReserveRightsTokenMock.d"
import { RSR } from "../typechain/RSR.d"
import { ContractFactory } from "ethers"
import { CompoundMath } from "../typechain/CompoundMath.d"

describe("RTokenDeployer contract", function () {
    let owner: SignerWithAddress
    let newOwner: SignerWithAddress
    let other: SignerWithAddress
    let rTokenImplementation: RTokenMock
    let iPoolImplementation: InsurancePoolMock
    let factory: RTokenDeployer
    let InsurancePool: ContractFactory
    let config: IRTokenParams
    let basketTokens: IBasketToken[]
    let prevRSRToken: ReserveRightsTokenMock
    let rsrToken: RSR
    let rsrTokenInfo: IRSRConfig
    let tokenAddress: string
    let iPoolAddress: string
    let rTokenInstance: RTokenMock
    let iPoolInstance: InsurancePoolMock
    let math: CompoundMath

    beforeEach(async function () {
        ;[owner, newOwner, other] = await ethers.getSigners()

        const CompoundMathFactory = await ethers.getContractFactory("CompoundMath")
        math = <CompoundMath>await CompoundMathFactory.deploy()

        // Deploy RToken and InsurancePool implementations
        const RToken = await ethers.getContractFactory("RTokenMock", {
            libraries: {
                CompoundMath: math.address,
            },
        })
        rTokenImplementation = <RTokenMock>await RToken.connect(owner).deploy()

        InsurancePool = await ethers.getContractFactory("InsurancePoolMock")
        iPoolImplementation = <InsurancePoolMock>await InsurancePool.connect(owner).deploy()

        // Deploy RTokenFactory
        const RTokenFactory = await ethers.getContractFactory("RTokenDeployer")
        factory = <RTokenDeployer>(
            await RTokenFactory.connect(owner).deploy(
                rTokenImplementation.address,
                iPoolImplementation.address
            )
        )
    })

    describe("Deployment", function () {
        it("Should start with the correct implementations defined", async function () {
            expect(await factory.rTokenImplementation()).to.equal(rTokenImplementation.address)
            expect(await factory.insurancePoolImplementation()).to.equal(
                iPoolImplementation.address
            )
        })
    })

    describe("Creating RTokens", function () {
        beforeEach(async function () {
            // RToken Configuration and setup
            config = {
                stakingDepositDelay: 0,
                stakingWithdrawalDelay: 0,
                maxSupply: 0,
                minMintingSize: 0,
                issuanceRate: 0,
                rebalancingFreezeCost: 0,
                insurancePaymentPeriod: 0,
                expansionPerSecond: 0,
                expenditureFactor: 0,
                spread: 0,
                exchange: ZERO_ADDRESS,
                circuitBreaker: ZERO_ADDRESS,
                txFeeCalculator: ZERO_ADDRESS,
                insurancePool: ZERO_ADDRESS,
                protocolFund: ZERO_ADDRESS,
            }

            basketTokens = [
                {
                    tokenAddress: ZERO_ADDRESS,
                    genesisQuantity: 0,
                    rateLimit: 1,
                    maxTrade: 1,
                    priceInRToken: 0,
                    slippageTolerance: 0,
                },
            ]

            // RSR (Insurance token)
            const PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock")
            const NewRSR = await ethers.getContractFactory("RSR")
            prevRSRToken = <ReserveRightsTokenMock>await PrevRSR.deploy("Reserve Rights", "RSR")
            rsrToken = <RSR>(
                await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS)
            )
            rsrTokenInfo = {
                tokenAddress: rsrToken.address,
                genesisQuantity: 0,
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0,
            }

            // Create a new RToken
            const receipt = await (
                await factory.deploy(
                    newOwner.address,
                    "RToken Test",
                    "RTKN",
                    config,
                    basketTokens,
                    rsrTokenInfo
                )
            ).wait()
            tokenAddress = expectInReceipt(receipt, "RTokenDeployed").args.rToken
        })

        it("Should deploy RToken and Insurance Pool correctly", async function () {
            const rTokenInstance = await ethers.getContractAt("RToken", tokenAddress)
            expect(await rTokenInstance.name()).to.equal("RToken Test")
            expect(await rTokenInstance.symbol()).to.equal("RTKN")
            expect(await rTokenInstance.totalSupply()).to.equal(0)

            // Check Insurance Pool
            const iPoolAddress = await rTokenInstance.insurancePool()
            const iPoolInstance = await InsurancePool.attach(iPoolAddress)
            expect(iPoolAddress).to.not.equal(iPoolImplementation.address)
            expect(tokenAddress).to.not.equal(rTokenImplementation.address)
            expect(await iPoolInstance.rToken()).to.equal(tokenAddress)
            expect(await iPoolInstance.rsr()).to.equal(rsrToken.address)
        })

        it("Should setup owner for RToken correctly", async function () {
            const rTokenInstance = await ethers.getContractAt("RToken", tokenAddress)
            expect(await rTokenInstance.owner()).to.equal(newOwner.address)
        })

        it("Should track tokens created by the factory", async () => {
            expect(await factory.isRToken(tokenAddress)).to.be.true
        })

        it("Should not track tokens that were not created by the factory", async () => {
            expect(await factory.isRToken(other.address)).to.be.false
        })
    })

    describe("Upgradeability", function () {
        beforeEach(async function () {
            // RToken Configuration and setup
            config = {
                stakingDepositDelay: 0,
                stakingWithdrawalDelay: 0,
                maxSupply: 0,
                minMintingSize: 0,
                issuanceRate: 0,
                rebalancingFreezeCost: 0,
                insurancePaymentPeriod: 0,
                expansionPerSecond: 0,
                expenditureFactor: 0,
                spread: 0,
                exchange: ZERO_ADDRESS,
                circuitBreaker: ZERO_ADDRESS,
                txFeeCalculator: ZERO_ADDRESS,
                insurancePool: ZERO_ADDRESS,
                protocolFund: ZERO_ADDRESS,
            }

            basketTokens = [
                {
                    tokenAddress: ZERO_ADDRESS,
                    genesisQuantity: 0,
                    rateLimit: 1,
                    maxTrade: 1,
                    priceInRToken: 0,
                    slippageTolerance: 0,
                },
            ]

            // RSR (Insurance token)
            const PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock")
            const NewRSR = await ethers.getContractFactory("RSR")
            prevRSRToken = <ReserveRightsTokenMock>await PrevRSR.deploy("Reserve Rights", "RSR")
            rsrToken = <RSR>(
                await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS)
            )
            rsrTokenInfo = {
                tokenAddress: rsrToken.address,
                genesisQuantity: 0,
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0,
            }

            // Create a new RToken
            const receipt = await (
                await factory.deploy(
                    newOwner.address,
                    "RToken Test",
                    "RTKN",
                    config,
                    basketTokens,
                    rsrTokenInfo
                )
            ).wait()
            tokenAddress = expectInReceipt(receipt, "RTokenDeployed").args.rToken

            // Get RToken
            rTokenInstance = <RTokenMock>await ethers.getContractAt("RToken", tokenAddress)

            // Get InsurancePool
            iPoolAddress = await rTokenInstance.insurancePool()
            iPoolInstance = <InsurancePoolMock>(
                await ethers.getContractAt("InsurancePoolMock", iPoolAddress)
            )
        })

        describe("RToken Upgradeability", function () {
            it("Should allow upgrades to RToken if Owner", async function () {
                // Deploy new RToken Implementation
                const RTokenV2 = await ethers.getContractFactory("RTokenMockV2", {
                    libraries: {
                        CompoundMath: math.address,
                    },
                })
                const rTokenV2Implementation = await RTokenV2.connect(owner).deploy()

                // Update implementation
                await rTokenInstance.connect(newOwner).upgradeTo(rTokenV2Implementation.address)

                //Check if new version is now being used
                const rTokenInstanceV2 = await RTokenV2.attach(tokenAddress)
                expect(await rTokenInstanceV2.getVersion()).to.equal("V2")
                // Confirm it maintains state
                expect(await rTokenInstanceV2.insurancePool()).to.equal(
                    await rTokenInstance.insurancePool()
                )
            })

            it("Should not allow upgrades to RToken if not Owner", async function () {
                // Deploy new RToken Implementation
                const RTokenV2 = await ethers.getContractFactory("RTokenMockV2", {
                    libraries: {
                        CompoundMath: math.address,
                    },
                })
                const rTokenV2Implementation = await RTokenV2.connect(owner).deploy()

                // Try to update implementation
                await expect(
                    rTokenInstance.connect(other).upgradeTo(rTokenV2Implementation.address)
                ).to.be.revertedWith("Ownable: caller is not the owner")
            })
        })

        describe("InsurancePool Upgradeability", function () {
            it("Should allow upgrades to InsurancePool if Owner", async function () {
                ;[owner, newOwner, other] = await ethers.getSigners()
                // Deploy new InsurancePool Implementation
                const IPoolV2 = await ethers.getContractFactory("InsurancePoolMockV2")
                const iPoolV2Implementation = await IPoolV2.connect(owner).deploy()

                // Update implementation
                await iPoolInstance.connect(newOwner).upgradeTo(iPoolV2Implementation.address)

                //Check if new version is now being used
                const iPoolInstanceV2 = await IPoolV2.attach(iPoolAddress)
                expect(await iPoolInstanceV2.getVersion()).to.equal("V2")
                // Confirm it maintains state
                expect(await iPoolInstanceV2.rsr()).to.equal(await iPoolInstance.rsr())
            })

            it("Should not allow upgrades to InsurancePool if not Owner", async function () {
                // Deploy new InsurancePool Implementation
                const IPoolV2 = await ethers.getContractFactory("InsurancePoolMockV2")
                const iPoolV2Implementation = await IPoolV2.connect(owner).deploy()

                // Try to update implementation
                await expect(
                    iPoolInstance.connect(other).upgradeTo(iPoolV2Implementation.address)
                ).to.be.revertedWith("Ownable: caller is not the owner")
            })
        })
    })
})
