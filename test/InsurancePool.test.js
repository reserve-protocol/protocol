const { expect } = require("chai");
const { ZERO_ADDRESS, MAX_UINT256 } = require("./utils/constants");
const { advanceTime } = require("./utils/time");
const { BigNumber } = require("ethers");


describe("InsurancePool contract", function () {
    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();

        // Deploy RSR Token
        PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock");
        NewRSR = await ethers.getContractFactory("RSR");
        prevRSRToken = await PrevRSR.deploy("Reserve Rights", "RSR");
        await prevRSRToken.mint(addr1.address, BigNumber.from(20000));
        await prevRSRToken.mint(addr2.address, BigNumber.from(15000));
        rsrToken = await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS);

        // Deploy RToken
        config = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS];
        basketTokens = [[ZERO_ADDRESS, 0, 0, 0, 0, 0, 0]];
        rsrTokenInfo = [rsrToken.address, 0, 0, 0, 0, 0, 0];
        RToken = await ethers.getContractFactory("RTokenMock");
        rToken = await RToken.connect(owner).deploy();
        await rToken.connect(owner).initialize("RToken", "RTKN", config, basketTokens, rsrTokenInfo);

        // Deploy InsurancePool
        InsurancePool = await ethers.getContractFactory("InsurancePoolMock");
        iPool = await InsurancePool.connect(owner).deploy();
        await iPool.connect(owner).initialize(rToken.address, rsrToken.address);

        // Update config to include InsurancePool address
        newConfig = config;
        newConfig[13] = iPool.address;
        await rToken.connect(owner).updateConfig(newConfig);
    });

    describe("Deployment", function () {
        it("Deployment should setup initial addresses correctly", async function () {
            expect(await iPool.rToken()).to.equal(rToken.address);
            expect(await iPool.rsr()).to.equal(rsrToken.address);
        });

        it("Should deploy with correct balance and allowance values", async function () {
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(0);
            expect(await rsrToken.allowance(iPool.address, rToken.address)).to.equal(MAX_UINT256);
            expect(await iPool.balanceOf(owner.address)).to.equal(0);
            expect(await iPool.balanceOf(addr1.address)).to.equal(0);
            expect(await iPool.balanceOf(addr2.address)).to.equal(0);
        });
    });

    describe("Deposits/Staking", function () {
        beforeEach(async function () {
            // Pause previous contract
            await prevRSRToken.connect(owner).pause();
        });

        it("Should allow to stake/deposit in RSR", async function () {
            // Perform stake
            const amount = BigNumber.from(1000);

            // Approve transfer
            await rsrToken.connect(addr1).approve(iPool.address, amount);

            // Stake
            await expect(iPool.connect(addr1).stake(amount))
                .to.emit(iPool, 'DepositInitiated')
                .withArgs(addr1.address, amount);

            // Check deposit properly registered   
            expect(await iPool.depositsCount()).to.equal(1);
            const [stakeAcc, stakeAmt] = await iPool.deposits(0);
            expect(stakeAcc).to.equal(addr1.address);
            expect(stakeAmt).to.equal(amount);

            // Check RSR balance
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount);
        });

        it("Should allow multiple stakes/deposits in RSR", async function () {
            // Perform stake
            const amount1 = BigNumber.from(1000);
            const amount2 = BigNumber.from(2000);
            const amount3 = BigNumber.from(3000);

            // Approve transfer
            await rsrToken.connect(addr1).approve(iPool.address, amount1.add(amount2));

            // Stake
            await expect(iPool.connect(addr1).stake(amount1))
                .to.emit(iPool, 'DepositInitiated')
                .withArgs(addr1.address, amount1);

            // Check deposits properly registered   
            expect(await iPool.depositsCount()).to.equal(1);
            let [stakeAcc, stakeAmt] = await iPool.deposits(0);
            expect(stakeAcc).to.equal(addr1.address);
            expect(stakeAmt).to.equal(amount1);

            // Stake again
            await expect(iPool.connect(addr1).stake(amount2))
                .to.emit(iPool, 'DepositInitiated')
                .withArgs(addr1.address, amount2);

            // Check deposits properly registered   
            expect(await iPool.depositsCount()).to.equal(2);
            [stakeAcc, stakeAmt] = await iPool.deposits(1);
            expect(stakeAcc).to.equal(addr1.address);
            expect(stakeAmt).to.equal(amount2);

            // New stake from different account
            await rsrToken.connect(addr2).approve(iPool.address, amount3);

            // Stake
            await expect(iPool.connect(addr2).stake(amount3))
                .to.emit(iPool, 'DepositInitiated')
                .withArgs(addr2.address, amount3);

            // Check deposit properly registered   
            expect(await iPool.depositsCount()).to.equal(3);
            [stakeAcc, stakeAmt] = await iPool.deposits(2);
            expect(stakeAcc).to.equal(addr2.address);
            expect(stakeAmt).to.equal(amount3);

            // Check RSR balance
            expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1.add(amount2.add(amount3)));
        });

        context("With stakes/deposits created", async function () {
            beforeEach(async function () {
                // Set stakingDepositDelay
                stakingDepositDelay = 20000;
                newConfig = config;
                newConfig[0] = stakingDepositDelay;
                await rToken.connect(owner).updateConfig(newConfig);

                // Perform stake
                amount1 = BigNumber.from(1000);
                amount2 = BigNumber.from(2000);
                amount3 = BigNumber.from(3000);

                // Approve transfer
                await rsrToken.connect(addr1).approve(iPool.address, amount1.add(amount2));
                await rsrToken.connect(addr2).approve(iPool.address, amount3);

                // Stake
                await expect(iPool.connect(addr1).stake(amount1))
                    .to.emit(iPool, 'DepositInitiated')
                    .withArgs(addr1.address, amount1);
            });

            it("Should not process deposits before stakingDepositDelay", async function () {
                // Process stakes
                await iPool.processDeposits();

                // Nothing processed so far
                expect(await iPool.depositIndex()).to.equal(0);
                expect(await iPool.totalWeight()).to.equal(0);
                expect(await iPool.weight(addr1.address)).to.equal(0);

                // Process stakes after certain time (still before stakingDepositDelay)
                await advanceTime(15000);

                await iPool.processDeposits();

                // Nothing processed still
                expect(await iPool.depositIndex()).to.equal(0);
                expect(await iPool.totalWeight()).to.equal(0);
                expect(await iPool.weight(addr1.address)).to.equal(0);

                // Check RSR balance - Funds should still be minting queue
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1);
            });

            it("Should process deposits after stakingDepositDelay", async function () {
                // Move forward past stakingDeposityDelay
                await advanceTime(stakingDepositDelay + 1);

                // Process stakes
                await iPool.processDeposits();

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1);
                expect(await iPool.totalWeight()).to.equal(amount1);
                expect(await iPool.weight(addr1.address)).to.equal(amount1);
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1);  

                // Check RSR balance
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1);
            });

            it("Should store weights and calculate balance correctly", async function () {
                // Move forward past stakingDeposityDelay
                await advanceTime(stakingDepositDelay + 1);

                // Process stakes
                await iPool.processDeposits();

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1);
                expect(await iPool.totalWeight()).to.equal(amount1);
                expect(await iPool.weight(addr1.address)).to.equal(amount1);

                await expect(iPool.connect(addr1).stake(amount2))
                    .to.emit(iPool, 'DepositInitiated')
                    .withArgs(addr1.address, amount2);

                await expect(iPool.connect(addr2).stake(amount3))
                    .to.emit(iPool, 'DepositInitiated')
                    .withArgs(addr2.address, amount3);

                // Move forward past stakingDeposityDelay
                await advanceTime(stakingDepositDelay + 1);

                // Process stakes
                await iPool.processDeposits();

                // Staking processed and weights calculated
                expect(await iPool.depositIndex()).to.equal(3);
                expect(await iPool.totalWeight()).to.equal(amount1.add(amount2.add(amount3)));
                expect(await iPool.weight(addr1.address)).to.equal(amount1.add(amount2));
                expect(await iPool.weight(addr2.address)).to.equal(amount3);
                expect(await iPool.balanceOf(addr1.address)).to.equal(amount1.add(amount2));  
                expect(await iPool.balanceOf(addr2.address)).to.equal(amount3);  

                // Check RSR balance
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1.add(amount2.add(amount3)));
            });

            it("Should handle prorata math after adding RSR", async function () {
                // Move forward past stakingDeposityDelay
                await advanceTime(stakingDepositDelay + 1);

                // Process stakes
                await iPool.processDeposits();

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1);
                expect(await iPool.totalWeight()).to.equal(amount1);
                expect(await iPool.weight(addr1.address)).to.equal(amount1);
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1);

                // Mock RToken donating RSR
                await rsrToken.connect(addr2).transfer(iPool.address, amount2);

                // Balance should be sum of deposit and revenue RSR
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount2.add(amount1));
            });

            it("Should handle prorata math after removing RSR", async function () {
                // Move forward past stakingDeposityDelay
                await advanceTime(stakingDepositDelay + 1);

                // Process stakes
                await iPool.processDeposits();

                // Staking/Deposit was processed
                expect(await iPool.depositIndex()).to.equal(1);
                expect(await iPool.totalWeight()).to.equal(amount1);
                expect(await iPool.weight(addr1.address)).to.equal(amount1);
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1);

                // Seize 1/3
                const toSeize = amount1.div(3);

                // Mock RToken seizing RSR
                await rToken.connect(addr1).seizeRSR(toSeize);

                // Balance should be 2/3 of original deposit
                expect(await rsrToken.balanceOf(iPool.address)).to.equal(amount1.sub(toSeize));
            });
        });
    });
});
