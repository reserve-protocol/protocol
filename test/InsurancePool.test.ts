import { expect } from "chai"
import { ethers } from "hardhat"
import { ZERO_ADDRESS, MAX_UINT256 } from "../common/constants"
import { advanceTime } from "./utils/time"
import { BigNumber, ContractFactory } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ReserveRightsTokenMock } from "../typechain/ReserveRightsTokenMock.d"
import { RSR } from "../typechain/RSR.d"
import { InsurancePoolMock } from "../typechain/InsurancePoolMock.d"
import { RTokenMock } from "../typechain/RTokenMock.d"

// RToken configuration
const config = {
    stakingDepositDelay: 0,
    stakingWithdrawalDelay: 0,
    maxSupply: BigNumber.from(5000000),
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

const basketTokens = [
    {
        tokenAddress: ZERO_ADDRESS,
        genesisQuantity: 0,
        rateLimit: 1,
        maxTrade: 1,
        priceInRToken: 0,
        slippageTolerance: 0,
    },
]

const rsrTokenInfo = {
    tokenAddress: "",
    genesisQuantity: 0,
    rateLimit: 1,
    maxTrade: 1,
    priceInRToken: 0,
    slippageTolerance: 0,
}

describe("InsurancePool contract", () => {
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let other: SignerWithAddress
    let PrevRSR: ContractFactory
    let NewRSR: ContractFactory
    let prevRSRToken: ReserveRightsTokenMock
    let initialBal1: BigNumber
    let rsrToken: RSR
    let rToken: RTokenMock
    let iPool: InsurancePoolMock

    beforeEach(async () => {
        ;[owner, addr1, addr2, other] = await ethers.getSigners()

        // Deploy RSR Token
        PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock")
        NewRSR = await ethers.getContractFactory("RSR")
        prevRSRToken = <ReserveRightsTokenMock>await PrevRSR.deploy("Reserve Rights", "RSR")
        initialBal1 = BigNumber.from(20000)
        await prevRSRToken.mint(addr1.address, initialBal1)
        await prevRSRToken.mint(addr2.address, BigNumber.from(15000))
        rsrToken = <RSR>(
            await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS)
        )

        rsrTokenInfo.tokenAddress = rsrToken.address

        // External math library
        const CompoundMath = await ethers.getContractFactory("CompoundMath")
        const math = await CompoundMath.deploy()

        // Deploy RToken and InsurancePool implementations
        const RToken = await ethers.getContractFactory("RTokenMock", {
            libraries: {
                CompoundMath: math.address,
            },
        })
        rToken = <RTokenMock>await RToken.connect(owner).deploy()
        await rToken.connect(owner).initialize("RToken", "RTKN", config, basketTokens, rsrTokenInfo)

        // Deploy InsurancePool
        const InsurancePool = await ethers.getContractFactory("InsurancePoolMock")
        iPool = <InsurancePoolMock>await InsurancePool.connect(owner).deploy()
        await iPool.connect(owner).initialize(rToken.address, rsrToken.address)
        await rToken.connect(owner).updateConfig({ ...config, insurancePool: iPool.address })
    })

    describe("Deployment", () => {
        it("Deployment should setup initial addresses correctly", async () => {
            expect(await iPool.rToken()).to.equal(rToken.address)
            expect(await iPool.rsr()).to.equal(rsrToken.address)
        })

        it("Should deploy with correct balance and allowance values", async () => {
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(0)
            expect(await rsrToken.allowance(iPool.address, rToken.address)).to.equal(MAX_UINT256)
            expect(await iPool.balanceOf(owner.address)).to.equal(0)
            expect(await iPool.balanceOf(addr1.address)).to.equal(0)
            expect(await iPool.balanceOf(addr2.address)).to.equal(0)
        })
    })

    describe("Deposits/Staking", () => {
        beforeEach(async () => {
            // Pause previous contract
            await prevRSRToken.connect(owner).pause()
        })

        it("Should allow to stake/deposit in RSR", async () => {
            // Perform stake
            const amount = BigNumber.from(1000)

            // Approve transfer
            await rsrToken.connect(addr1).approve(iPool.address, amount)

            // Stake
            await expect(iPool.connect(addr1).stake(amount))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr1.address, amount)

            // Check deposit properly registered
            expect(await iPool.depositsCount()).to.equal(1)
            const [stakeAcc, stakeAmt] = await iPool.deposits(0)
            expect(stakeAcc).to.equal(addr1.address)
            expect(stakeAmt).to.equal(amount)

            // Check RSR balance
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount)
        })

        it("Should not allow to stake amount = 0", async () => {
            // Perform stake
            const amount = BigNumber.from(1000)
            const zero = BigNumber.from(0)

            // Approve transfer
            await rsrToken.connect(addr1).approve(iPool.address, amount)

            // Stake
            await expect(iPool.connect(addr1).stake(zero)).to.be.revertedWith("CannotStakeZero()")

            // Check deposit not registered
            expect(await iPool.depositsCount()).to.equal(0)
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(0)
        })

        it("Should allow multiple stakes/deposits in RSR", async () => {
            // Perform stake
            const amount1 = BigNumber.from(1000)
            const amount2 = BigNumber.from(2000)
            const amount3 = BigNumber.from(3000)

            // Approve transfer
            await rsrToken.connect(addr1).approve(iPool.address, amount1.add(amount2))

            // Stake
            await expect(iPool.connect(addr1).stake(amount1))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr1.address, amount1)

            // Check deposits properly registered
            expect(await iPool.depositsCount()).to.equal(1)
            let [stakeAcc, stakeAmt] = await iPool.deposits(0)
            expect(stakeAcc).to.equal(addr1.address)
            expect(stakeAmt).to.equal(amount1)

            // Stake again
            await expect(iPool.connect(addr1).stake(amount2))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr1.address, amount2)

            // Check deposits properly registered
            expect(await iPool.depositsCount()).to.equal(2)
            ;[stakeAcc, stakeAmt] = await iPool.deposits(1)
            expect(stakeAcc).to.equal(addr1.address)
            expect(stakeAmt).to.equal(amount2)

            // New stake from different account
            await rsrToken.connect(addr2).approve(iPool.address, amount3)

            // Stake
            await expect(iPool.connect(addr2).stake(amount3))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr2.address, amount3)

            // Check deposit properly registered
            expect(await iPool.depositsCount()).to.equal(3)
            ;[stakeAcc, stakeAmt] = await iPool.deposits(2)
            expect(stakeAcc).to.equal(addr2.address)
            expect(stakeAmt).to.equal(amount3)

            // Check RSR balance
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(
                amount1.add(amount2.add(amount3))
            )
        })

        context("With stakes/deposits created", async () => {
            let amount1: BigNumber
            let amount2: BigNumber
            let amount3: BigNumber
            const stakingDepositDelay = 20000

            beforeEach(async () => {
                // Set stakingDelay
                await rToken.connect(owner).updateConfig({ ...config, stakingDepositDelay })

                // Perform stake
                amount1 = BigNumber.from(1000)
                amount2 = BigNumber.from(2000)
                amount3 = BigNumber.from(3000)

                // Approve transfer
                await rsrToken.connect(addr1).approve(iPool.address, amount1.add(amount2))
                await rsrToken.connect(addr2).approve(iPool.address, amount3)

                // Stake
                await expect(iPool.connect(addr1).stake(amount1))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount1)
            })

            it("Should not process deposits before stakingDepositDelay", async () => {
                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Nothing processed so far
                expect(await iPool.depositIndex()).to.equal(0)
                expect(await iPool.totalWeight()).to.equal(0)
                expect(await iPool.weight(addr1.address)).to.equal(0)
                // No weight adjustment processed
                let [wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(0)
                expect(wAdjUpdated).to.be.false

                // Process stakes after certain time (still before stakingDepositDelay)
                await advanceTime(15000)

                await iPool.processWithdrawalsAndDeposits()

                // Nothing processed still
                expect(await iPool.depositIndex()).to.equal(0)
                expect(await iPool.totalWeight()).to.equal(0)
                expect(await iPool.weight(addr1.address)).to.equal(0)
                ;[wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(0)
                expect(wAdjUpdated).to.be.false

                // Check RSR balance - Funds should still be minting queue
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1)
            })

            it("Should process deposits after stakingDepositDelay", async () => {
                // Move forward past stakingDepositDelay
                await advanceTime(stakingDepositDelay + 1)

                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1)
                expect(await iPool.totalWeight()).to.equal(amount1)
                expect(await iPool.weight(addr1.address)).to.equal(amount1)
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1)
                // check adjusted weights
                let [wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(amount1)
                expect(wAdjUpdated).to.be.true

                // Check RSR balance
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1)
            })

            it("Should store weights and calculate balance correctly", async () => {
                // Move forward past stakingDepositDelay
                await advanceTime(stakingDepositDelay + 1)

                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1)
                expect(await iPool.totalWeight()).to.equal(amount1)
                expect(await iPool.weight(addr1.address)).to.equal(amount1)

                await expect(iPool.connect(addr1).stake(amount2))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount2)

                await expect(iPool.connect(addr2).stake(amount3))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount3)

                // Move forward past stakingDepositDelay
                await advanceTime(stakingDepositDelay + 1)

                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Staking processed and weights calculated
                expect(await iPool.depositIndex()).to.equal(3)
                expect(await iPool.totalWeight()).to.equal(amount1.add(amount2.add(amount3)))
                expect(await iPool.weight(addr1.address)).to.equal(amount1.add(amount2))
                expect(await iPool.weight(addr2.address)).to.equal(amount3)
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1.add(amount2))
                expect(await iPool.balanceOf(addr2.address)).to.equal(amount3)

                // check adjusted weights
                let [wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(amount1.add(amount2))
                expect(wAdjUpdated).to.be.true
                ;[wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr2.address, 0)
                expect(wAdjAmount).to.equal(amount3)
                expect(wAdjUpdated).to.be.true

                // Check RSR balance
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(
                    amount1.add(amount2.add(amount3))
                )
            })

            it("Should handle prorata math after adding RSR", async () => {
                // Move forward past stakingDepositDelay
                await advanceTime(stakingDepositDelay + 1)

                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1)
                expect(await iPool.totalWeight()).to.equal(amount1)
                expect(await iPool.weight(addr1.address)).to.equal(amount1)
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1)
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1)

                // Mock RToken donating RSR
                await rsrToken.connect(addr2).transfer(iPool.address, amount2)
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount2.add(amount1))

                // Balance should be sum of deposit and revenue RSR
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount2.add(amount1))
            })

            it("Should handle prorata math after removing RSR", async () => {
                // Move forward past stakingDepositDelay
                await advanceTime(stakingDepositDelay + 1)

                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1)
                expect(await iPool.totalWeight()).to.equal(amount1)
                expect(await iPool.weight(addr1.address)).to.equal(amount1)
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1)
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1)

                // Seize 1/3
                const toSeize = amount1.div(3)

                // Mock RToken seizing RSR
                await rToken.connect(addr1).seizeRSR(toSeize)
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1.sub(toSeize))

                // Balance should be 2/3 of original deposit
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1.sub(toSeize))
            })
        })
    })

    describe("Withdrawals/Unstaking", () => {
        beforeEach(async () => {
            // Pause previous contract
            await prevRSRToken.connect(owner).pause()
        })

        it("Should allow to unstake/withdraw", async () => {
            // Stake
            const amount = BigNumber.from(1000)

            // Stake
            await rsrToken.connect(addr1).approve(iPool.address, amount)
            await expect(iPool.connect(addr1).stake(amount))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr1.address, amount)

            // Process Deposits
            await iPool.processWithdrawalsAndDeposits()

            // Check RSR balance, should not change
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount)

            // Unstake
            await expect(iPool.connect(addr1).unstake(amount))
                .to.emit(iPool, "WithdrawalInitiated")
                .withArgs(addr1.address, amount)

            // Check withdrawal properly registered
            expect(await iPool.withdrawalsCount()).to.equal(1)
            const [unstakeAcc, unstakeAmt] = await iPool.withdrawals(0)
            expect(unstakeAcc).to.equal(addr1.address)
            expect(unstakeAmt).to.equal(amount)
        })

        it("Should not allow to unstake amount = 0", async () => {
            // Perform stake
            const zero = BigNumber.from(0)

            // Unstake
            await expect(iPool.connect(addr1).unstake(zero)).to.be.revertedWith(
                "CannotWithdrawZero()"
            )

            // Check withdrawal not registered
            expect(await iPool.withdrawalsCount()).to.equal(0)
        })

        it("Should not allow to unstake if not enough balance", async () => {
            // Perform stake
            const amount = BigNumber.from(1000)

            // Unstake with account with no balance
            await expect(iPool.connect(other).unstake(amount)).to.be.revertedWith(
                "NotEnoughBalance()"
            )

            // Check withdrawal not registered
            expect(await iPool.withdrawalsCount()).to.equal(0)
        })

        it("Should allow multiple unstakes/withdrawals in RSR", async () => {
            // Perform stake
            const amount1 = BigNumber.from(1000)
            const amount2 = BigNumber.from(2000)
            const amount3 = BigNumber.from(3000)

            // Approve transfer
            await rsrToken.connect(addr1).approve(iPool.address, amount1.add(amount2))
            await rsrToken.connect(addr2).approve(iPool.address, amount3)

            // Stake
            await expect(iPool.connect(addr1).stake(amount1))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr1.address, amount1)

            await expect(iPool.connect(addr1).stake(amount2))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr1.address, amount2)

            await expect(iPool.connect(addr2).stake(amount3))
                .to.emit(iPool, "DepositInitiated")
                .withArgs(addr2.address, amount3)

            // Unstake
            await expect(iPool.connect(addr1).unstake(amount1))
                .to.emit(iPool, "WithdrawalInitiated")
                .withArgs(addr1.address, amount1)

            // Check withdrawal properly registered
            expect(await iPool.withdrawalsCount()).to.equal(1)
            let [unstakeAcc, unstakeAmt] = await iPool.withdrawals(0)
            expect(unstakeAcc).to.equal(addr1.address)
            expect(unstakeAmt).to.equal(amount1)

            // Unstake again
            await expect(iPool.connect(addr1).unstake(amount2))
                .to.emit(iPool, "WithdrawalInitiated")
                .withArgs(addr1.address, amount2)

            // Check withrawals properly registered
            expect(await iPool.withdrawalsCount()).to.equal(2)
            ;[unstakeAcc, unstakeAmt] = await iPool.withdrawals(1)
            expect(unstakeAcc).to.equal(addr1.address)
            expect(unstakeAmt).to.equal(amount2)

            // Unstake from different account
            await expect(iPool.connect(addr2).unstake(amount3))
                .to.emit(iPool, "WithdrawalInitiated")
                .withArgs(addr2.address, amount3)

            // Check deposit properly registered
            expect(await iPool.withdrawalsCount()).to.equal(3)
            ;[unstakeAcc, unstakeAmt] = await iPool.withdrawals(2)
            expect(unstakeAcc).to.equal(addr2.address)
            expect(unstakeAmt).to.equal(amount3)
        })

        context("With deposits and withdrawals", async () => {
            let amount1: BigNumber
            let amount2: BigNumber
            let amount3: BigNumber
            const stakingWithdrawalDelay = 20000

            beforeEach(async () => {
                // Set stakingWithdrawalDelay

                await rToken.connect(owner).updateConfig({ ...config, stakingWithdrawalDelay })

                // Perform stake
                amount1 = BigNumber.from(1000)
                amount2 = BigNumber.from(2000)
                amount3 = BigNumber.from(3000)

                // Approve transfer
                await rsrToken.connect(addr1).approve(iPool.address, amount1)
                await rsrToken.connect(addr2).approve(iPool.address, amount2.add(amount3))

                // Stakes
                await expect(iPool.connect(addr1).stake(amount1))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount1)

                await expect(iPool.connect(addr2).stake(amount2))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount2)

                await expect(iPool.connect(addr2).stake(amount3))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount3)

                // Process deposits
                await iPool.processWithdrawalsAndDeposits()

                // Create Withdrawal
                await expect(iPool.connect(addr1).unstake(amount1))
                    .to.emit(iPool, "WithdrawalInitiated")
                    .withArgs(addr1.address, amount1)
            })

            it("Should not process withdrawals before stakingWithdrawalDelay", async () => {
                // Process unstakes
                await iPool.processWithdrawalsAndDeposits()

                // Nothing processed so far
                expect(await iPool.withdrawalIndex()).to.equal(0)
                expect(await iPool.totalWeight()).to.equal(amount1.add(amount2).add(amount3))
                expect(await iPool.weight(addr1.address)).to.equal(amount1)
                // No weight adjustment processed
                let [wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(amount1)
                expect(wAdjUpdated).to.be.true

                // Process unstakes after certain time (still before stakingWithdrawalDelay)
                await advanceTime(15000)

                await iPool.processWithdrawalsAndDeposits()

                // Nothing processed still
                expect(await iPool.withdrawalIndex()).to.equal(0)
                expect(await iPool.totalWeight()).to.equal(amount1.add(amount2).add(amount3))
                expect(await iPool.weight(addr1.address)).to.equal(amount1)
                // No weight adjustment processed
                ;[wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(amount1)
                expect(wAdjUpdated).to.be.true

                // Check RSR balance - Funds should still be in the contract
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(
                    amount1.add(amount2).add(amount3)
                )
            })

            it("Should process withdrawals after stakingWithdrawalDelay", async () => {
                // Get current balance for user
                const prevAddr1Balance = await rsrToken.balanceOf(addr1.address)

                // Move forward past stakingWithdrawalDelay
                await advanceTime(stakingWithdrawalDelay + 1)

                // Process stakes
                await iPool.processWithdrawalsAndDeposits()

                // Withdrawal was processed
                expect(await iPool.withdrawalIndex()).to.equal(1)
                expect(await iPool.totalWeight()).to.equal(amount2.add(amount3))
                expect(await iPool.weight(addr1.address)).to.equal(0)
                expect(await iPool.balanceOf(addr1.address)).to.equal(0)
                // Should record weight adjustment
                let [wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(0)
                expect(wAdjUpdated).to.be.true

                // Check RSR balance
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount2.add(amount3))
                expect(await rsrToken.balanceOf(addr1.address)).to.equal(
                    prevAddr1Balance.add(amount1)
                )
            })

            it("Should store weights and calculate balance correctly", async () => {
                // Get current balances for users
                const prevAddr1Balance = await rsrToken.balanceOf(addr1.address)
                const prevAddr2Balance = await rsrToken.balanceOf(addr2.address)

                // Create additional withdrawal
                await expect(iPool.connect(addr2).unstake(amount2))
                    .to.emit(iPool, "WithdrawalInitiated")
                    .withArgs(addr2.address, amount2)

                // Move forward past stakingWithdrawalDelaylay
                await advanceTime(stakingWithdrawalDelay + 1)

                // Process unstakes
                await iPool.processWithdrawalsAndDeposits()

                // Withdrawals were processed
                expect(await iPool.withdrawalIndex()).to.equal(2)
                expect(await iPool.totalWeight()).to.equal(amount3)
                expect(await iPool.weight(addr1.address)).to.equal(0)
                expect(await iPool.weight(addr2.address)).to.equal(amount3)
                // Check weight adjustments
                let [wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr1.address, 0)
                expect(wAdjAmount).to.equal(0)
                expect(wAdjUpdated).to.be.true
                ;[wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr2.address, 0)
                expect(wAdjAmount).to.equal(amount3)
                expect(wAdjUpdated).to.be.true

                // Create additional withdrawal
                await expect(iPool.connect(addr2).unstake(amount3))
                    .to.emit(iPool, "WithdrawalInitiated")
                    .withArgs(addr2.address, amount3)

                // Move forward past stakingWithdrawalDelay
                await advanceTime(stakingWithdrawalDelay + 1)

                // Process unstakes
                await iPool.processWithdrawalsAndDeposits()

                // Withdrawals processed and weights calculated
                expect(await iPool.withdrawalIndex()).to.equal(3)
                expect(await iPool.totalWeight()).to.equal(0)
                expect(await iPool.weight(addr1.address)).to.equal(0)
                expect(await iPool.weight(addr2.address)).to.equal(0)
                expect(await iPool.balanceOf(addr1.address)).to.equal(0)
                expect(await iPool.balanceOf(addr2.address)).to.equal(0)

                // Check weight adjustments
                ;[wAdjAmount, wAdjUpdated] = await iPool.weightsAdjustments(addr2.address, 0)
                expect(wAdjAmount).to.equal(0)
                expect(wAdjUpdated).to.be.true

                // Check RSR balance
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(0)
                expect(await rsrToken.balanceOf(addr1.address)).to.equal(
                    prevAddr1Balance.add(amount1)
                )
                expect(await rsrToken.balanceOf(addr2.address)).to.equal(
                    prevAddr2Balance.add(amount2.add(amount3))
                )
            })
        })
    })

    describe("Revenues", () => {
        beforeEach(async () => {
            // Pause previous contract
            await prevRSRToken.connect(owner).pause()
        })

        it("Should not allow to register Revenue if caller is not Rtoken", async () => {
            const amount = BigNumber.from(1000)

            await expect(iPool.connect(owner).makeInsurancePayment(amount)).to.be.revertedWith(
                "OnlyRToken()"
            )

            expect(await rToken.balanceOf(iPool.address)).to.equal(0)
        })

        it("Should allow to register Revenue if caller is Rtoken", async () => {
            const amount = BigNumber.from(1000)

            await expect(rToken.makeInsurancePayment(amount))
                .to.emit(iPool, "RevenueEventSaved")
                .withArgs(0, amount)

            expect(await rToken.balanceOf(rToken.address)).to.equal(0)
            expect(await rToken.balanceOf(iPool.address)).to.equal(amount)

            // Check revenue properly registered
            expect(await iPool.revenuesCount()).to.equal(1)
            const [revAmt, stakeAmt] = await iPool.revenues(0)
            expect(revAmt).to.equal(amount)
            expect(stakeAmt).to.equal(await iPool.totalWeight())
        })

        it("Should allow to register multiple Revenues", async () => {
            const amount1 = BigNumber.from(1000)
            const amount2 = BigNumber.from(2000)

            await expect(rToken.makeInsurancePayment(amount1))
                .to.emit(iPool, "RevenueEventSaved")
                .withArgs(0, amount1)

            // // Check revenue properly registered
            expect(await iPool.revenuesCount()).to.equal(1)
            let [revAmt, stakeAmt] = await iPool.revenues(0)
            expect(revAmt).to.equal(amount1)
            expect(stakeAmt).to.equal(await iPool.totalWeight())

            await expect(rToken.makeInsurancePayment(amount2))
                .to.emit(iPool, "RevenueEventSaved")
                .withArgs(1, amount2)

            // Check revenue properly registered
            expect(await iPool.revenuesCount()).to.equal(2)
            ;[revAmt, stakeAmt] = await iPool.revenues(1)
            expect(revAmt).to.equal(amount2)
            expect(stakeAmt).to.equal(await iPool.totalWeight())

            expect(await rToken.balanceOf(rToken.address)).to.equal(0)
            expect(await rToken.balanceOf(iPool.address)).to.equal(amount1.add(amount2))
        })

        context("With revenues registered", async () => {
            let amount1: BigNumber
            let amount2: BigNumber
            let amount3: BigNumber
            let revAmount: BigNumber
            let revAmount2: BigNumber
            let revAmount3: BigNumber

            beforeEach(async () => {
                amount1 = BigNumber.from(1000)
                amount2 = BigNumber.from(3000)
                amount3 = BigNumber.from(6000)
                revAmount = BigNumber.from(100)
                revAmount2 = BigNumber.from(800)
                revAmount3 = BigNumber.from(300)

                // Approve transfer
                await rsrToken.connect(addr1).approve(iPool.address, amount1)

                // Stake
                await expect(iPool.connect(addr1).stake(amount1))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount1)

                // Process depoaits
                await iPool.processWithdrawalsAndDeposits()

                // Register Revenue
                await expect(rToken.makeInsurancePayment(revAmount))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(0, revAmount)

                // Check revenue properly registered
                expect(await iPool.revenuesCount()).to.equal(1)
            })

            it("Should process single revenue correctly", async () => {
                expect(await iPool.lastIndex(addr1.address)).to.equal(0)
                expect(await iPool.earned(addr1.address)).to.equal(0)

                // Process revenues
                await iPool.catchup(addr1.address, 5)

                expect(await iPool.lastIndex(addr1.address)).to.equal(1)
                expect(await iPool.earned(addr1.address)).to.equal(revAmount)
            })

            it("Should not process revenues for account = 0", async () => {
                // Process revenues
                await iPool.catchup(ZERO_ADDRESS, 5)

                expect(await iPool.lastIndex(ZERO_ADDRESS)).to.equal(0)
                expect(await iPool.earned(ZERO_ADDRESS)).to.equal(0)
            })

            it("Should process multiple revenues correctly", async () => {
                expect(await iPool.lastIndex(addr1.address)).to.equal(0)
                expect(await iPool.earned(addr1.address)).to.equal(0)

                // Register additional revenues
                await expect(rToken.makeInsurancePayment(revAmount2))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(1, revAmount2)

                await expect(rToken.makeInsurancePayment(revAmount3))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(2, revAmount3)

                // Check revenues properly registered
                expect(await iPool.revenuesCount()).to.equal(3)

                // Process Revenues
                await iPool.catchup(addr1.address, 10)

                expect(await iPool.lastIndex(addr1.address)).to.equal(3)
                expect(await iPool.earned(addr1.address)).to.equal(
                    revAmount.add(revAmount2.add(revAmount3))
                )
            })

            it("Should not include revenues previous to deposit", async () => {
                // Process revenues
                await iPool.catchup(addr1.address, 5)

                expect(await iPool.lastIndex(addr1.address)).to.equal(1)
                expect(await iPool.earned(addr1.address)).to.equal(revAmount)

                // Approve transfer
                await rsrToken.connect(addr2).approve(iPool.address, amount2)

                // Stake
                await expect(iPool.connect(addr2).stake(amount2))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount2)

                // Process deposit
                await iPool.processWithdrawalsAndDeposits()

                // Process revenues
                await iPool.catchup(addr2.address, 5)

                expect(await iPool.lastIndex(addr2.address)).to.equal(1)
                expect(await iPool.earned(addr2.address)).to.equal(0)
            })

            it("Should apply weight adjustments correctly for each revenue", async () => {
                // Check Initial Weights
                let weightAdj = await iPool.weightsAdjustments(addr1.address, 0)
                expect(weightAdj[0]).to.equal(amount1)
                expect(weightAdj[1]).to.be.true

                weightAdj = await iPool.weightsAdjustments(addr1.address, 1)
                expect(weightAdj[0]).to.equal(0)
                expect(weightAdj[1]).to.be.false

                // Register New Revenue
                await expect(rToken.makeInsurancePayment(revAmount2))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(1, revAmount2)

                // Register new Deposit  - Catches up account as well
                await rsrToken.connect(addr1).approve(iPool.address, amount2)
                await expect(iPool.connect(addr1).stake(amount2))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount2)

                // Process deposit
                await iPool.processWithdrawalsAndDeposits()

                // Check Weight adjustments
                weightAdj = await iPool.weightsAdjustments(addr1.address, 1)
                expect(weightAdj[0]).to.equal(0)
                expect(weightAdj[1]).to.be.false

                weightAdj = await iPool.weightsAdjustments(addr1.address, 2)
                expect(weightAdj[0]).to.equal(amount1.add(amount2))
                expect(weightAdj[1]).to.be.true

                // Register new revenue
                await expect(rToken.makeInsurancePayment(revAmount3))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(2, revAmount3)

                // New deposit - Catches up account as well
                await rsrToken.connect(addr1).approve(iPool.address, amount3)
                await expect(iPool.connect(addr1).stake(amount3))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount3)

                // Process deposit
                await iPool.processWithdrawalsAndDeposits()

                // Check Weight adjustments
                weightAdj = await iPool.weightsAdjustments(addr1.address, 3)
                expect(weightAdj[0]).to.equal(amount1.add(amount2.add(amount3)))
                expect(weightAdj[1]).to.be.true

                // Verify total deposits/revenues
                expect(await iPool.weight(addr1.address)).to.equal(
                    amount1.add(amount2.add(amount3))
                )
                expect(await iPool.totalWeight()).to.equal(amount1.add(amount2.add(amount3)))
                expect(await iPool.revenuesCount()).to.equal(3)
                expect(await iPool.lastIndex(addr1.address)).to.equal(3)
                expect(await iPool.earned(addr1.address)).to.equal(
                    revAmount.add(revAmount2.add(revAmount3))
                )
            })

            it("Should processs multiple revenues for multiple accounts correctly", async () => {
                // Approve transfer
                await rsrToken.connect(addr1).approve(iPool.address, amount2)
                // Stake
                await expect(iPool.connect(addr1).stake(amount2))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount2)

                // Approve transfer
                await rsrToken.connect(addr2).approve(iPool.address, amount3)
                // Stake
                await expect(iPool.connect(addr2).stake(amount3))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount3)

                // Process deposit
                await iPool.processWithdrawalsAndDeposits()

                // Register Revenue
                await expect(rToken.makeInsurancePayment(revAmount2))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(1, revAmount2)

                // Register Revenue
                await expect(rToken.makeInsurancePayment(revAmount3))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(2, revAmount3)

                // Check revenue properly registered
                expect(await iPool.revenuesCount()).to.equal(3)

                // Process revenues
                await iPool.catchup(addr1.address, 5)
                await iPool.catchup(addr2.address, 5)

                // Revenues 2 and 3 apply to Address1 and Address2 with 40% and 60% respectively
                const splitRevenue = revAmount2.add(revAmount3)
                const splitRevAddr1 = splitRevenue.mul(40).div(100)
                const splitRevAddr2 = splitRevenue.mul(60).div(100)
                expect(await iPool.lastIndex(addr1.address)).to.equal(3)
                expect(await iPool.lastIndex(addr2.address)).to.equal(3)
                expect(await iPool.earned(addr1.address)).to.equal(revAmount.add(splitRevAddr1))
                expect(await iPool.earned(addr2.address)).to.equal(splitRevAddr2)
            })

            it("Should processs withdrawals and reductions in weight correctly", async () => {
                // Approve transfer
                await rsrToken.connect(addr1).approve(iPool.address, amount2)
                // Stake
                await expect(iPool.connect(addr1).stake(amount2))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr1.address, amount2)

                // Approve transfer
                await rsrToken.connect(addr2).approve(iPool.address, amount3)
                // Stake
                await expect(iPool.connect(addr2).stake(amount3))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount3)

                // Process deposit
                await iPool.processWithdrawalsAndDeposits()

                // Register Revenue
                await expect(rToken.makeInsurancePayment(revAmount2))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(1, revAmount2)

                // Stake
                await expect(iPool.connect(addr2).unstake(amount3))
                    .to.emit(iPool, "WithdrawalInitiated")
                    .withArgs(addr2.address, amount3)

                // Process wihtdrawal
                await iPool.processWithdrawalsAndDeposits()

                // Register Revenue
                await expect(rToken.makeInsurancePayment(revAmount3))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(2, revAmount3)

                // Check revenue properly registered
                expect(await iPool.revenuesCount()).to.equal(3)

                // Process revenues
                await iPool.catchup(addr1.address, 5)
                await iPool.catchup(addr2.address, 5)

                // Revenue 2 apply to Address1 and Address2 with 40% and 60% respectively.
                // All the others to addr1 only
                const splitRevenue = revAmount2
                const splitRevAddr1 = splitRevenue.mul(40).div(100)
                const splitRevAddr2 = splitRevenue.mul(60).div(100)
                expect(await iPool.lastIndex(addr1.address)).to.equal(3)
                expect(await iPool.lastIndex(addr2.address)).to.equal(3)
                expect(await iPool.earned(addr1.address)).to.equal(
                    revAmount.add(revAmount3.add(splitRevAddr1))
                )
                expect(await iPool.earned(addr2.address)).to.equal(splitRevAddr2)
            })

            it("Should process revenues for deposits recognized in same transaction", async () => {
                // Approve transfer
                await rsrToken.connect(addr2).approve(iPool.address, amount1)
                // Stake
                await expect(iPool.connect(addr2).stake(amount1))
                    .to.emit(iPool, "DepositInitiated")
                    .withArgs(addr2.address, amount1)

                // Register Revenue - it will process previous deposit in same transaction
                await expect(rToken.makeInsurancePayment(revAmount2))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(1, revAmount2)

                // Process revenues
                await iPool.catchup(addr2.address, 5)

                // Revenue 2 divided 50% and 50% respectively
                const splitRevenue = revAmount2
                const splitRevAddr2 = splitRevenue.mul(50).div(100)
                expect(await iPool.lastIndex(addr1.address)).to.equal(0) // Not caught up yet
                expect(await iPool.lastIndex(addr2.address)).to.equal(2)
                expect(await iPool.earned(addr2.address)).to.equal(splitRevAddr2)

                // Catchup address 1 as well
                await iPool.catchup(addr1.address, 5)
                const splitRevAddr1 = splitRevenue.mul(50).div(100)
                expect(await iPool.lastIndex(addr1.address)).to.equal(2)
                expect(await iPool.earned(addr1.address)).to.equal(revAmount.add(splitRevAddr1))
            })

            it("Should allow to catchup in multiple small transactions", async () => {
                // Create additional revenues
                const revAmount4 = BigNumber.from(500)
                const revAmount5 = BigNumber.from(800)

                await expect(rToken.makeInsurancePayment(revAmount2))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(1, revAmount2)

                await expect(rToken.makeInsurancePayment(revAmount3))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(2, revAmount3)

                await expect(rToken.makeInsurancePayment(revAmount4))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(3, revAmount4)

                await expect(rToken.makeInsurancePayment(revAmount5))
                    .to.emit(iPool, "RevenueEventSaved")
                    .withArgs(4, revAmount5)

                expect(await iPool.revenuesCount()).to.equal(5)

                // Not caught up yet
                expect(await iPool.lastIndex(addr1.address)).to.equal(0)
                expect(await iPool.earned(addr1.address)).to.equal(0)
                // Process subset of revenues
                await expect(iPool.catchup(addr1.address, 2))
                    .to.emit(iPool, "AccountPendingUpdate")
                    .withArgs(addr1.address)

                // Check progress
                expect(await iPool.lastIndex(addr1.address)).to.equal(2)
                expect(await iPool.earned(addr1.address)).to.equal(revAmount.add(revAmount2))

                // Process subset revenues
                await expect(iPool.catchup(addr1.address, 1))
                    .to.emit(iPool, "AccountPendingUpdate")
                    .withArgs(addr1.address)

                // Check progress
                expect(await iPool.lastIndex(addr1.address)).to.equal(3)
                expect(await iPool.earned(addr1.address)).to.equal(
                    revAmount.add(revAmount2.add(revAmount3))
                )

                // Process final subset revenues
                await expect(iPool.catchup(addr1.address, 2)).to.not.emit(
                    iPool,
                    "AccountPendingUpdate"
                )

                // Check all processed
                expect(await iPool.lastIndex(addr1.address)).to.equal(5)
                expect(await iPool.earned(addr1.address)).to.equal(
                    revAmount.add(revAmount2.add(revAmount3.add(revAmount4.add(revAmount5))))
                )
            })

            it("Should allow to claim revenues", async () => {
                expect(await iPool.lastIndex(addr1.address)).to.equal(0)
                expect(await iPool.earned(addr1.address)).to.equal(0)

                // Process revenues
                await iPool.catchup(addr1.address, 5)

                await expect(iPool.connect(addr1).claimRevenue())
                    .to.emit(iPool, "RevenueClaimed")
                    .withArgs(addr1.address, revAmount)

                expect(await rToken.balanceOf(iPool.address)).to.equal(0)
                expect(await rToken.balanceOf(addr1.address)).to.equal(revAmount)
            })

            it("Should process pending revenues when claiming", async () => {
                expect(await iPool.lastIndex(addr1.address)).to.equal(0)
                expect(await iPool.earned(addr1.address)).to.equal(0)

                await expect(iPool.connect(addr1).claimRevenue())
                    .to.emit(iPool, "RevenueClaimed")
                    .withArgs(addr1.address, revAmount)

                expect(await rToken.balanceOf(iPool.address)).to.equal(0)
                expect(await rToken.balanceOf(addr1.address)).to.equal(revAmount)
            })

            it("Should not send funds if no revenues to claim", async () => {
                await expect(iPool.connect(addr2).claimRevenue()).to.not.emit(
                    iPool,
                    "RevenueClaimed"
                )

                expect(await rToken.balanceOf(iPool.address)).to.equal(revAmount)
                expect(await rToken.balanceOf(addr2.address)).to.equal(0)
            })
        })
    })
})
