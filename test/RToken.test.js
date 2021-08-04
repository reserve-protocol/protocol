const { expect } = require("chai");
const { ZERO_ADDRESS } = require("../common/constants");
const { advanceTime } = require("./utils/time");
const { BigNumber } = require("ethers");

// Sample Values for Configuration
const stakingDepositDelay = 3600; // seconds
const stakingWithdrawalDelay = 4800; // seconds
const issuanceRate = BigNumber.from(25000);
const maxSupply = BigNumber.from(1000000);

describe("RToken contract", function () {

    beforeEach(async function () {
        [owner, addr1, addr2, other] = await ethers.getSigners();

        CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
        cb = await CircuitBreaker.deploy(owner.address);

        // RToken Configuration and setup
        config = {
            stakingDepositDelay: stakingDepositDelay,
            stakingWithdrawalDelay: stakingWithdrawalDelay,
            maxSupply: maxSupply,
            minMintingSize: 0,
            issuanceRate: issuanceRate,
            rebalancingFreezeCost: 0,
            insurancePaymentPeriod: 0,
            expansionPerSecond: 0,
            expenditureFactor: 0,
            spread: 0,
            exchange: ZERO_ADDRESS,
            circuitBreaker: cb.address,
            txFeeCalculator: ZERO_ADDRESS,
            insurancePool: ZERO_ADDRESS,
            protocolFund: ZERO_ADDRESS
        };

        basketTokens = [
            {
                tokenAddress: ZERO_ADDRESS,
                genesisQuantity: 0,
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0
            }
        ];
        // RSR (Insurance token)
        PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock");
        NewRSR = await ethers.getContractFactory("RSR");
        prevRSRToken = await PrevRSR.deploy("Reserve Rights", "RSR");
        rsrToken = await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS);
        // Set RSR token info
        rsrTokenInfo = {
            tokenAddress: rsrToken.address,
            genesisQuantity: 0,
            rateLimit: 1,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0
        };

        // External math lib
        CompoundMath = await ethers.getContractFactory("CompoundMath");
        math = await CompoundMath.deploy();

        // Deploy RToken and InsurancePool implementations
        RToken = await ethers.getContractFactory("RTokenMock", {
            libraries: {
                CompoundMath: math.address,
            }
        });        
        // Deploy RToken
        rToken = await RToken.connect(owner).deploy();
        await rToken.connect(owner).initialize("RToken", "RTKN", config, basketTokens, rsrTokenInfo);
    });

    describe("Deployment", function () {
        it("Deployment should setup initial values correctly", async function () {
            expect(await rToken.issuanceRate()).to.equal(issuanceRate);
            expect(await rToken.circuitBreaker()).to.equal(cb.address);
            expect(await rToken.stakingDepositDelay()).to.equal(stakingDepositDelay);
            expect(await rToken.stakingWithdrawalDelay()).to.equal(stakingWithdrawalDelay);
            expect(await rToken.maxSupply()).to.equal(maxSupply);
        });

        it("Should deploy with no tokens", async function () {
            const ownerBalance = await rToken.balanceOf(owner.address);
            expect(await rToken.totalSupply()).to.equal(ownerBalance);
            expect(await rToken.totalSupply()).to.equal(0);
        });
    });

    describe("Updates/Changes to Configuration", function () {

        describe("stakingDepositDelay", function () {
            beforeEach(async function () {
                currentValue = stakingDepositDelay;
                newValue = 1000;
                newConfig = config;
            });

            it("Should update correctly if Owner", async function () {
                expect(await rToken.stakingDepositDelay()).to.equal(currentValue);

                // Update individual field
                newConfig.stakingDepositDelay = newValue;
                await expect(rToken.connect(owner).updateConfig(newConfig))
                    .to.emit(rToken, "ConfigUpdated");

                expect(await rToken.stakingDepositDelay()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await rToken.stakingDepositDelay()).to.equal(currentValue);

                // Update individual field
                newConfig.stakingDepositDelay = newValue;
                await expect(
                    rToken.connect(addr1).updateConfig(newConfig)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await rToken.stakingDepositDelay()).to.equal(currentValue);
            });
        });

        describe("stakingWithdrawalDelay", function () {
            beforeEach(async function () {
                currentValue = stakingWithdrawalDelay;
                newValue = 1000;
                newConfig = config;
            });

            it("Should update correctly if Owner", async function () {
                expect(await rToken.stakingWithdrawalDelay()).to.equal(currentValue);

                // Update individual field
                newConfig.stakingWithdrawalDelay = newValue;
                await expect(rToken.connect(owner).updateConfig(newConfig))
                    .to.emit(rToken, "ConfigUpdated");

                expect(await rToken.stakingWithdrawalDelay()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await rToken.stakingWithdrawalDelay()).to.equal(currentValue);

                // Update individual field
                newConfig.stakingWithdrawalDelay = newValue;
                await expect(
                    rToken.connect(addr1).updateConfig(newConfig)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await rToken.stakingWithdrawalDelay()).to.equal(currentValue);
            });
        });

        describe("maxSupply", function () {
            beforeEach(async function () {
                currentValue = maxSupply;
                newValue = BigNumber.from(500000);
                newConfig = config;
            });

            it("Should update correctly if Owner", async function () {
                expect(await rToken.maxSupply()).to.equal(currentValue);

                // Update individual field
                newConfig.maxSupply = newValue;
                await expect(rToken.connect(owner).updateConfig(newConfig))
                    .to.emit(rToken, "ConfigUpdated");

                expect(await rToken.maxSupply()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await rToken.maxSupply()).to.equal(currentValue);

                // Update individual field
                newConfig.maxSupply = newValue;
                await expect(
                    rToken.connect(addr1).updateConfig(newConfig)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await rToken.maxSupply()).to.equal(currentValue);
            });
        });

        describe("issuanceRate", function () {
            beforeEach(async function () {
                currentValue = issuanceRate;
                newValue = BigNumber.from(10000);
                newConfig = config;
            });

            it("Should update correctly if Owner", async function () {
                expect(await rToken.issuanceRate()).to.equal(currentValue);

                // Update individual field
                newConfig.issuanceRate = newValue;
                await expect(rToken.connect(owner).updateConfig(newConfig))
                    .to.emit(rToken, "ConfigUpdated");

                expect(await rToken.issuanceRate()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await rToken.issuanceRate()).to.equal(currentValue);

                // Update individual field
                newConfig.issuanceRate = newValue;
                await expect(
                    rToken.connect(addr1).updateConfig(newConfig)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await rToken.issuanceRate()).to.equal(currentValue);
            });
        });

        describe("circuitBreaker", function () {
            beforeEach(async function () {
                currentValue = cb.address;
                cbNew = await CircuitBreaker.deploy(owner.address);
                newValue = cbNew.address;
                newConfig = config;
            });

            it("Should update correctly if Owner", async function () {
                expect(await rToken.circuitBreaker()).to.equal(currentValue);

                // Update individual field
                newConfig.circuitBreaker = newValue;
                await expect(rToken.connect(owner).updateConfig(newConfig))
                    .to.emit(rToken, "ConfigUpdated");

                expect(await rToken.circuitBreaker()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await rToken.circuitBreaker()).to.equal(currentValue);

                // Update individual field
                newConfig.circuitBreaker = newValue;
                await expect(
                    rToken.connect(addr1).updateConfig(newConfig)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await rToken.circuitBreaker()).to.equal(currentValue);
            });
        });

        describe("txFeeCalculator", function () {
            beforeEach(async function () {
                currentValue = ZERO_ADDRESS;
                TxFeeCalculator = await ethers.getContractFactory("TXFeeCalculatorMock");
                txFeeNew = await TxFeeCalculator.deploy();
                newValue = txFeeNew.address;
                newConfig = config;
            });

            it("Should update correctly if Owner", async function () {
                expect(await rToken.txFeeCalculator()).to.equal(currentValue);

                // Update individual field
                newConfig.txFeeCalculator = newValue;
                await expect(rToken.connect(owner).updateConfig(newConfig))
                    .to.emit(rToken, "ConfigUpdated");

                expect(await rToken.txFeeCalculator()).to.equal(newValue);
            });

            it("Should not allow to update if not Owner", async function () {
                expect(await rToken.txFeeCalculator()).to.equal(currentValue);

                // Update individual field
                newConfig.txFeeCalculator = newValue;
                await expect(
                    rToken.connect(addr1).updateConfig(newConfig)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                expect(await rToken.txFeeCalculator()).to.equal(currentValue);
            });
        });
    });

    describe("Slow Minting", function () {
        it("Should start minting", async function () {
            let amount = BigNumber.from(1000);
            await expect(rToken.startMinting(owner.address, amount))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount)
        });

        it("Should process Mintings in one attempt for amounts smaller than issuance rate", async function () {
            let amount = BigNumber.from(1000);
            await expect(rToken.startMinting(owner.address, amount))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount);

            // No Tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            // Check Tokens were minted
            expect(await rToken.balanceOf(owner.address)).to.equal(amount);
            expect(await rToken.totalSupply()).to.equal(amount);

            // Minting again has no impact as queue is empty
            await rToken["tryProcessMintings()"]();

            // Check Tokens were minted
            expect(await rToken.balanceOf(owner.address)).to.equal(amount);
            expect(await rToken.totalSupply()).to.equal(amount);
        });

        it("Should process Mintings in multiple attempts (2 blocks)", async function () {
            let amount = BigNumber.from(50000);
            let issuanceRate = await rToken.issuanceRate();
            let blocks = amount / issuanceRate;

            await expect(rToken.startMinting(owner.address, amount))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount);

            // No Tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens not minted until two blocks have passed
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            // Tokens minted
            expect(await rToken.balanceOf(owner.address)).to.equal(amount);
            expect(await rToken.balanceOf(owner.address)).to.equal(blocks * issuanceRate);
            expect(await rToken.totalSupply()).to.equal(amount);
        });

        it("Should process Mintings in multiple attempts (3 blocks)", async function () {
            let amount = BigNumber.from(74000);
            let issuanceRate = await rToken.issuanceRate();
            let blocks = amount / issuanceRate;
            await expect(rToken.startMinting(owner.address, amount))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount);

            // No Tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens not minted until three blocks have passed
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens not minted until three blocks have passed
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            // Tokens minted
            expect(await rToken.balanceOf(owner.address)).to.equal(amount);
            expect(await rToken.balanceOf(owner.address)).to.equal(blocks * issuanceRate);
            expect(await rToken.totalSupply()).to.equal(amount);
        });

        it("Should process multiple Mintings in queue in single issuance", async function () {
            let amount1 = BigNumber.from(2000);
            let amount2 = BigNumber.from(3000);
            let amount3 = BigNumber.from(5000);
            let amount4 = BigNumber.from(6000);

            await expect(rToken.startMinting(owner.address, amount1))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount1);

            await expect(rToken.startMinting(owner.address, amount2))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount2);

            await expect(rToken.startMinting(owner.address, amount3))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount3);

            await expect(rToken.startMinting(owner.address, amount4))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount4);

            // No Tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens minted in single issuance
            expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2).add(amount3).add(amount4));
            expect(await rToken.totalSupply()).to.equal(amount1.add(amount2).add(amount3).add(amount4));
        });

        it("Should process multiple Mintings in queue until exceeding rate", async function () {
            let amount1 = BigNumber.from(10000);
            let amount2 = BigNumber.from(15000);
            let amount3 = BigNumber.from(20000);

            await expect(rToken.startMinting(owner.address, amount1))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount1);

            await expect(rToken.startMinting(owner.address, amount2))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount2);

            await expect(rToken.startMinting(owner.address, amount3))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount3);

            // No Tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens minted in single issuance
            expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2));
            expect(await rToken.totalSupply()).to.equal(amount1.add(amount2));
        });

        it("Should process multiple Mintings in multiple issuances", async function () {
            let amount1 = BigNumber.from(60000);
            let amount2 = BigNumber.from(20000);

            await expect(rToken.startMinting(owner.address, amount1))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount1);

            await expect(rToken.startMinting(owner.address, amount2))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount2);

            // No Tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  No tokens minted yet
            expect(await rToken.balanceOf(owner.address)).to.equal(0);
            expect(await rToken.totalSupply()).to.equal(0);


            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens minted for first mint
            expect(await rToken.balanceOf(owner.address)).to.equal(amount1);
            expect(await rToken.totalSupply()).to.equal(amount1);

            // Process Mintings
            await rToken["tryProcessMintings()"]();

            //  Tokens minted for second mint
            expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2));
            expect(await rToken.totalSupply()).to.equal(amount1.add(amount2));
        });

        it("Should process Mintings and count all mined blocks in between", async function () {
            let amount = BigNumber.from(80000);

            // Mine block
            await advanceTime(60);

            await expect(rToken.startMinting(owner.address, amount))
                .to.emit(rToken, 'SlowMintingInitiated')
                .withArgs(owner.address, amount);

            // Mine block
            await advanceTime(60);

            // Mine another block
            await advanceTime(60);

            // Mine a third  block
            await advanceTime(60);

            // Process Mintings - Now its the 4th block - Should mint
            await rToken["tryProcessMintings()"]();

            // Mine block
            advanceTime(60);

            //  Tokens minted for first mint
            expect(await rToken.balanceOf(owner.address)).to.equal(amount);
            expect(await rToken.totalSupply()).to.equal(amount);
        });

        // TODO: Remove is this will not be enabled again
        // it("Should process Mintings on transfer", async function () {
        //     const amount = BigNumber.from(10000);
        //     const transferAmount = BigNumber.from(500);

        //     await expect(rToken.startMinting(owner.address, amount))
        //         .to.emit(rToken, 'SlowMintingInitiated')
        //         .withArgs(owner.address, amount);

        //     // No Tokens minted yet
        //     expect(await rToken.balanceOf(owner.address)).to.equal(0);
        //     expect(await rToken.totalSupply()).to.equal(0);

        //     // Perform transfer
        //     await rToken.connect(owner).transfer(addr1.address, transferAmount);

        //     //  Tokens minted
        //     expect(await rToken.balanceOf(owner.address)).to.equal(amount.sub(transferAmount));
        //     expect(await rToken.balanceOf(addr1.address)).to.equal(transferAmount);
        //     expect(await rToken.totalSupply()).to.equal(amount);
        // });

        // TODO: Remove is this will not be enabled again
        // it("Should process Mintings on transferFrom", async function () {
        //     const amount1 = BigNumber.from(10000);
        //     const amount2 = BigNumber.from(10000);
        //     const transferAmount = BigNumber.from(500);

        //     await expect(rToken.startMinting(owner.address, amount1))
        //         .to.emit(rToken, 'SlowMintingInitiated')
        //         .withArgs(owner.address, amount1);

        //     await expect(rToken.startMinting(owner.address, amount2))
        //         .to.emit(rToken, 'SlowMintingInitiated')
        //         .withArgs(owner.address, amount2);

        //     // No Tokens minted yet
        //     expect(await rToken.balanceOf(owner.address)).to.equal(0);
        //     expect(await rToken.totalSupply()).to.equal(0);

        //     // Set allowance and transfer
        //     await rToken.connect(owner).approve(addr1.address, transferAmount);
        //     await rToken.connect(addr1).transferFrom(owner.address, addr2.address, transferAmount);

        //     //  Tokens minted
        //     expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2).sub(transferAmount));
        //     expect(await rToken.balanceOf(addr2.address)).to.equal(transferAmount);
        //     expect(await rToken.totalSupply()).to.equal(amount1.add(amount2));
        // });

        // TODO: Reimplement once RelayERC20 is integrated with RToken
        // it("Should process Mintings on relayedTransfer", async function () {
        //     const amount = BigNumber.from(10000);
        //     const transferAmount = BigNumber.from(500);

        //     await expect(rToken.startMinting(owner.address, amount))
        //         .to.emit(rToken, 'SlowMintingInitiated')
        //         .withArgs(owner.address, amount);;

        //     // No Tokens minted yet
        //     expect(await rToken.balanceOf(owner.address)).to.equal(0);
        //     expect(await rToken.totalSupply()).to.equal(0);

        //     // Perform Relayed transfer
        //     // Transfer 50 tokens from owner to addr1, relayed by another account
        //     const nonce = await rToken.metaNonces(owner.address);
        //     const hash = ethers.utils.solidityKeccak256(
        //         ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
        //         ["relayedTransfer", rToken.address, owner.address, addr1.address, transferAmount, 0, nonce]
        //     );
        //     const sigHashBytes = ethers.utils.arrayify(hash);
        //     const sig = await owner.signMessage(sigHashBytes)

        //     await expect(rToken.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, transferAmount, 0))
        //         .to.emit(rToken, 'TransferForwarded')
        //         .withArgs(sig, owner.address, addr1.address, transferAmount, 0);

        //     //  Tokens minted
        //     expect(await rToken.balanceOf(owner.address)).to.equal(amount.sub(transferAmount));
        //     expect(await rToken.balanceOf(addr1.address)).to.equal(transferAmount);
        //     expect(await rToken.totalSupply()).to.equal(amount);
        // });
    });

    describe("Tx Fees", function () {

        beforeEach(async function () {
            // Mint initial tokens
            await rToken.mint(owner.address, BigNumber.from(1000));

            // Deploy TxFeeCalculator
            TxFeeCalculator = await ethers.getContractFactory("TXFeeCalculatorMock");
            txFeeCalc = await TxFeeCalculator.deploy();
            newTxFeeConfig = config;
            newTxFeeConfig.txFeeCalculator = txFeeCalc.address;
        });

        it("Should not apply fees by default", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(50);

            expect(await rToken.balanceOf(rToken.address)).to.equal(0);
            expect(await rToken.balanceOf(addr1.address)).to.equal(0);

            // Perform transfer
            await rToken.connect(owner).transfer(addr1.address, amount);

            // No fee taken, correct amount received
            expect(await rToken.balanceOf(addr1.address)).to.equal(amount);
            expect(await rToken.balanceOf(rToken.address)).to.equal(0);
        });

        it("Should apply fees if TxFee calculator is defined", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(50);
            const fee = amount.mul(10).div(100);

            // Setup TxFee Calculator
            await rToken.connect(owner).updateConfig(newTxFeeConfig);

            expect(await rToken.balanceOf(rToken.address)).to.equal(0);
            expect(await rToken.balanceOf(addr1.address)).to.equal(0);

            // Perform transfer
            await rToken.connect(owner).transfer(addr1.address, amount);

            // Should take a 10% fee, correct amount received
            expect(await rToken.balanceOf(addr1.address)).to.equal(amount);
            expect(await rToken.balanceOf(rToken.address)).to.equal(fee);
        });

        it("Should cap TxFee to the total amount (max)", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(50);

            // Set new percentage to 200%
            await txFeeCalc.setFeePct(200);
            await rToken.connect(owner).updateConfig(newTxFeeConfig);

            expect(await rToken.balanceOf(rToken.address)).to.equal(0);

            // Perform transfer
            await rToken.connect(owner).transfer(addr1.address, amount);

            // Should take a 10% fee, correct amount received
            expect(await rToken.balanceOf(addr1.address)).to.equal(amount);
            expect(await rToken.balanceOf(rToken.address)).to.equal(amount);
        });

        it("Should not allow transfer if user cannot pay fee", async function () {
            // Transfer all balance from owner to addr1
            const amount = BigNumber.from(1000);

            // Setup TxFee Calculator
            await rToken.connect(owner).updateConfig(newTxFeeConfig);

            expect(await rToken.balanceOf(rToken.address)).to.equal(0);
            expect(await rToken.balanceOf(addr1.address)).to.equal(0);

            await expect(
                rToken.connect(owner).transfer(addr1.address, amount)
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

            // No transfer was processed
            expect(await rToken.balanceOf(addr1.address)).to.equal(0);
            expect(await rToken.balanceOf(rToken.address)).to.equal(0);
        });
    });

    describe("ERC20 functionality", function () {

        beforeEach(async function () {
            // Mint initial tokens
            await rToken.mint(owner.address, BigNumber.from(1000));
        });

        it("Should not be able to send to contract externally", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(50);

            await expect(
                rToken.connect(owner).transfer(rToken.address, amount)
            ).to.be.revertedWith("TransferToContractAddress()");
        });
    });
});
