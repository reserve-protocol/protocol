const { expect } = require("chai");
const { ZERO_ADDRESS } = require("./utils/constants");
const { BigNumber } = require("ethers");

// Sample Values for Configuration
const stakingDepositDelay = 3600; // seconds
const stakingWithdrawalDelay = 4800; // seconds
const issuanceRate = BigNumber.from(25000);

describe("Configuration contract", function () {

    describe("Deployment", function () {
        it("Deployment should setup CircuitBreaker and Issuance Rate", async function () {
            const [owner] = await ethers.getSigners();

            const Configuration = await ethers.getContractFactory("Configuration");

            CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
            cb = await CircuitBreaker.deploy(owner.address);

            const conf = await Configuration.deploy([[ZERO_ADDRESS, 0, 0, 0, 0]], [ZERO_ADDRESS, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, issuanceRate, 0, cb.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);

            expect(await conf.issuanceRate()).to.equal(issuanceRate);
            expect(await conf.circuitBreaker()).to.equal(cb.address);
        });

        it("Deployment should setup StakingDepositDelay and StakingWithdrawalDelay", async function () {
            const Configuration = await ethers.getContractFactory("Configuration");

            const conf = await Configuration.deploy([[ZERO_ADDRESS, 0, 0, 0, 0]], [ZERO_ADDRESS, 0, 0, 0, 0], [stakingDepositDelay, stakingWithdrawalDelay, 0, 0, 0, 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);

            expect(await conf.stakingDepositDelay()).to.equal(stakingDepositDelay);
            expect(await conf.stakingWithdrawalDelay()).to.equal(stakingWithdrawalDelay);
        });
    });

    describe("Updates/Changes", function () {
        beforeEach(async function () {
            const Configuration = await ethers.getContractFactory("Configuration");
            [owner, addr1] = await ethers.getSigners();
            CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
            cb = await CircuitBreaker.deploy(owner.address);
            conf = await Configuration.deploy([[ZERO_ADDRESS, 0, 0, 0, 0]], [ZERO_ADDRESS, 0, 0, 0, 0], [stakingDepositDelay, stakingWithdrawalDelay, 0, 0, 0, 0, 0, issuanceRate, 0, cb.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);
        });

        describe("stakingDepositDelay", function () {
            beforeEach(async function () {
                currentValue = stakingDepositDelay;
                newValue = 1000;
            });

            it("Should update correctly if Owner", async function () {
                expect(await conf.stakingDepositDelay()).to.equal(currentValue);

                await expect(conf.connect(owner).setStakingDepositDelay(newValue))
                    .to.emit(conf, "UIntConfigurationUpdated")
                    .withArgs("stakingDepositDelay", currentValue, newValue);

                expect(await conf.stakingDepositDelay()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await conf.stakingDepositDelay()).to.equal(currentValue);

                await expect(
                    conf.connect(addr1).setStakingDepositDelay(newValue)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await conf.stakingDepositDelay()).to.equal(currentValue);
            });
        });

        describe("stakingWithdrawalDelay", function () {
            beforeEach(async function () {
                currentValue = stakingWithdrawalDelay;
                newValue = 1000;
            });

            it("Should update correctly if Owner", async function () {
                expect(await conf.stakingWithdrawalDelay()).to.equal(currentValue);

                await expect(conf.connect(owner).setStakingWithdrawalDelay(newValue))
                    .to.emit(conf, "UIntConfigurationUpdated")
                    .withArgs("stakingWithdrawalDelay", currentValue, newValue);

                expect(await conf.stakingWithdrawalDelay()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await conf.stakingWithdrawalDelay()).to.equal(currentValue);

                await expect(
                    conf.connect(addr1).setStakingWithdrawalDelay(newValue)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await conf.stakingWithdrawalDelay()).to.equal(currentValue);
            });
        });

        describe("issuanceRate", function () {
            beforeEach(async function () {
                currentValue = issuanceRate;
                newValue = BigNumber.from(10000);
            });

            it("Should update correctly if Owner", async function () {
                expect(await conf.issuanceRate()).to.equal(currentValue);

                await expect(conf.connect(owner).setIssuanceRate(newValue))
                    .to.emit(conf, "UIntConfigurationUpdated")
                    .withArgs("issuanceRate", currentValue, newValue);

                expect(await conf.issuanceRate()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await conf.issuanceRate()).to.equal(currentValue);

                await expect(
                    conf.connect(addr1).setIssuanceRate(newValue)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await conf.issuanceRate()).to.equal(currentValue);
            });
        });

        describe("circuitBreaker", function () {
            beforeEach(async function () {
                currentValue = cb.address;
                newValue = (await CircuitBreaker.deploy(owner.address)).address;
            });
            it("Should update correctly if Owner", async function () {
                expect(await conf.circuitBreaker()).to.equal(currentValue);

                await expect(conf.connect(owner).setCircuitBreaker(newValue))
                    .to.emit(conf, "AddressConfigurationUpdated")
                    .withArgs("circuitBreaker", currentValue, newValue);

                expect(await conf.circuitBreaker()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await conf.circuitBreaker()).to.equal(currentValue);

                await expect(
                    conf.connect(addr1).setCircuitBreaker(newValue)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await conf.circuitBreaker()).to.equal(currentValue);
            });
        });
    });
});
